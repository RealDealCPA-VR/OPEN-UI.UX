import { z } from 'zod';
import { defineTool } from '@opencodex/core';

const input = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  maxResponseBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .optional(),
});

export interface WebFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  contentType: string | null;
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

export const webFetchTool = defineTool({
  name: 'web_fetch',
  description:
    'Fetch a URL over HTTP(S). Hosts must be in the configured allowlist (OPENCODEX_WEB_FETCH_ALLOWLIST). Response body is capped and may be truncated.',
  inputZod: input,
  permissionTier: 'network',
  async execute(args, ctx): Promise<WebFetchResult> {
    const parsed = new URL(args.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`web_fetch: unsupported protocol ${parsed.protocol}`);
    }

    const allowlist = readAllowlist();
    if (!isHostAllowed(parsed.hostname, allowlist)) {
      throw new Error(
        `web_fetch: host "${parsed.hostname}" is not in the allowlist. ` +
          `Set OPENCODEX_WEB_FETCH_ALLOWLIST (comma-separated, supports "*.example.com").`,
      );
    }

    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = args.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    const timeoutAc = new AbortController();
    const timer = setTimeout(
      () => timeoutAc.abort(new Error(`web_fetch: timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      // Follow redirects manually so the host allowlist is enforced on EVERY
      // hop. With `redirect: 'follow'` an allowlisted host could 30x-redirect to
      // an internal address (cloud metadata at 169.254.169.254, 127.0.0.1, ...)
      // and fetch would chase it unchecked — an SSRF bypass of the allowlist.
      let currentUrl = args.url;
      let res: Response | undefined;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetch(currentUrl, {
          method: args.method ?? 'GET',
          headers: args.headers,
          body: args.body,
          signal: AbortSignal.any([ctx.signal, timeoutAc.signal]),
          redirect: 'manual',
        });
        const isRedirect = res.status >= 300 && res.status < 400;
        const location = isRedirect ? res.headers.get('location') : null;
        if (!location) break;
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          throw new Error(`web_fetch: redirect to unsupported protocol ${nextUrl.protocol}`);
        }
        if (!isHostAllowed(nextUrl.hostname, allowlist)) {
          throw new Error(
            `web_fetch: blocked redirect to non-allowlisted host "${nextUrl.hostname}"`,
          );
        }
        await res.body?.cancel().catch(() => undefined);
        res = undefined;
        currentUrl = nextUrl.toString();
      }
      if (!res) {
        throw new Error(`web_fetch: too many redirects (>${MAX_REDIRECTS})`);
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const { body, truncated } = await readBodyCapped(res, maxBytes);

      return {
        status: res.status,
        headers,
        body,
        truncated,
        contentType: res.headers.get('content-type'),
        finalUrl: currentUrl,
      };
    } finally {
      clearTimeout(timer);
    }
  },
});

async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { body: '', truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (value.length > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated };
}

export function readAllowlist(): string[] {
  const raw = process.env.OPENCODEX_WEB_FETCH_ALLOWLIST ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isHostAllowed(hostname: string, allowlist: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of allowlist) {
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      if (host === base || host.endsWith('.' + base)) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
}
