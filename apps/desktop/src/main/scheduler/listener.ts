import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logger } from '../logger';

/**
 * Local HTTP listener that backs webhook triggers and git-hook callbacks.
 *
 * Security boundary:
 * - binds to 127.0.0.1 only (no exposure beyond loopback)
 * - validates an HMAC-SHA256 signature over the raw body, using the per-task
 *   secret stored in `scheduled_tasks.trigger_json`
 * - rate-limits to 1 request / second / task
 * - rejects non-JSON content-types and non-POST methods
 * - every request is logged (path, status) via structured pino
 *
 * Port discovery: tries each port in DEFAULT_PORT_RANGE in turn until one
 * binds successfully. The chosen port is persisted to settings so the next
 * boot starts from the same port (and the renderer URL stays stable).
 */

export const DEFAULT_PORT_RANGE_START = 38400;
export const DEFAULT_PORT_RANGE_END = 38500;
export const SIGNATURE_HEADER = 'x-opencodex-signature';
export const RATE_LIMIT_WINDOW_MS = 1000;
export const MAX_BODY_BYTES = 64 * 1024;
export const LAST_TRIGGER_TTL_MS = 60_000;
export const LAST_TRIGGER_MAX_ENTRIES = 10_000;

export type TriggerKind = 'webhook' | 'git-hook';

export interface ListenerCallbackArgs {
  taskId: string;
  kind: TriggerKind;
  body: unknown;
}

export interface ListenerCallback {
  (args: ListenerCallbackArgs): Promise<void> | void;
}

export interface TaskSecretLookup {
  /** Returns the HMAC secret for the task, or null if the task does not exist
   *  or its trigger does not authorize listener callbacks. */
  (taskId: string): { kind: TriggerKind; secret: string } | null;
}

export interface ListenerStartOptions {
  /** Optional preferred port — must be in 1-65535. Tried first; if it fails,
   *  the listener falls back to the default range. */
  preferredPort?: number | null;
  /** Inclusive start of the port range to try. */
  rangeStart?: number;
  /** Inclusive end of the port range to try. */
  rangeEnd?: number;
  /** Returns the secret + kind for a task, or null. Required. */
  lookupTaskSecret: TaskSecretLookup;
  /** Called once a valid signed request lands. Should fire the task. */
  onTrigger: ListenerCallback;
}

export interface ListenerInfo {
  port: number;
  url: (taskId: string) => string;
}

let server: Server | null = null;
let boundPort: number | null = null;
const lastTriggerAt = new Map<string, number>();

function bytesEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifySignature(body: string, header: string, secret: string): boolean {
  if (!header) return false;
  // Accept either the raw hex digest or a `sha256=<hex>` prefix.
  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  try {
    return bytesEqual(Buffer.from(provided.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function isRateLimited(taskId: string, now: number): boolean {
  const prev = lastTriggerAt.get(taskId);
  if (prev === undefined) return false;
  return now - prev < RATE_LIMIT_WINDOW_MS;
}

function pruneLastTriggerAt(now: number): void {
  for (const [id, ts] of lastTriggerAt) {
    if (now - ts > LAST_TRIGGER_TTL_MS) {
      lastTriggerAt.delete(id);
    }
  }
  if (lastTriggerAt.size >= LAST_TRIGGER_MAX_ENTRIES) {
    const entries = [...lastTriggerAt.entries()].sort((a, b) => a[1] - b[1]);
    const drop = lastTriggerAt.size - Math.floor(LAST_TRIGGER_MAX_ENTRIES / 2);
    for (let i = 0; i < drop; i++) {
      const entry = entries[i];
      if (entry) lastTriggerAt.delete(entry[0]);
    }
  }
}

function recordTriggerAt(taskId: string, now: number): void {
  lastTriggerAt.set(taskId, now);
  if (lastTriggerAt.size >= Math.floor(LAST_TRIGGER_MAX_ENTRIES / 2)) {
    pruneLastTriggerAt(now);
  }
}

function pickRange(opts: ListenerStartOptions): number[] {
  const start = opts.rangeStart ?? DEFAULT_PORT_RANGE_START;
  const end = opts.rangeEnd ?? DEFAULT_PORT_RANGE_END;
  const out: number[] = [];
  if (
    opts.preferredPort != null &&
    Number.isInteger(opts.preferredPort) &&
    opts.preferredPort > 0 &&
    opts.preferredPort <= 65535
  ) {
    out.push(opts.preferredPort);
  }
  for (let p = start; p <= end; p++) {
    if (p !== opts.preferredPort) out.push(p);
  }
  return out;
}

async function tryBind(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const srv = createServer();
    let settled = false;
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      // EADDRINUSE / EACCES → try next port; other errors → log + skip
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
        logger.warn({ err: err.message, port }, 'listener bind: unexpected error');
      }
      try {
        srv.close();
      } catch {
        // ignore
      }
      resolve(null);
    });
    srv.on('listening', () => {
      if (settled) return;
      settled = true;
      resolve(srv);
    });
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Start the local listener. Tries each port in opts.preferredPort + range and
 * binds the first one that's free. Returns the bound port + URL helper.
 * Returns null if no port in the range was available.
 */
export async function startListener(opts: ListenerStartOptions): Promise<ListenerInfo | null> {
  await stopListener();
  const ports = pickRange(opts);
  let srv: Server | null = null;
  let chosen: number | null = null;
  for (const port of ports) {
    const bound = await tryBind(port);
    if (bound) {
      srv = bound;
      chosen = port;
      break;
    }
  }
  if (!srv || chosen === null) {
    logger.warn(
      {
        rangeStart: opts.rangeStart ?? DEFAULT_PORT_RANGE_START,
        rangeEnd: opts.rangeEnd ?? DEFAULT_PORT_RANGE_END,
      },
      'listener: no port available in range',
    );
    return null;
  }

  srv.on('request', (req, res) => {
    void handleRequest(req, res, opts).catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'listener: unhandled error',
      );
      try {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      } catch {
        // ignore
      }
    });
  });

  server = srv;
  boundPort = chosen;
  logger.info({ port: chosen }, 'scheduler listener started');
  return {
    port: chosen,
    url: (taskId: string): string =>
      `http://127.0.0.1:${chosen}/trigger/${encodeURIComponent(taskId)}`,
  };
}

export async function stopListener(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  boundPort = null;
  lastTriggerAt.clear();
  await new Promise<void>((resolve) => {
    s.close(() => resolve());
  });
  logger.info('scheduler listener stopped');
}

export function getListenerPort(): number | null {
  return boundPort;
}

export function buildTriggerUrl(taskId: string, port: number): string {
  return `http://127.0.0.1:${port}/trigger/${encodeURIComponent(taskId)}`;
}

async function readBodyAsString(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let total = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (aborted) return;
      resolve(null);
    });
  });
}

function parseTaskIdFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  // We only accept paths of the form /trigger/<taskId>. Reject query strings,
  // extra path segments, percent-encoded path traversal attempts, etc.
  const pathOnly = rawUrl.split('?')[0]?.split('#')[0] ?? '';
  const m = pathOnly.match(/^\/trigger\/([^/]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? '');
  } catch {
    return null;
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ListenerStartOptions,
): Promise<void> {
  const url = req.url ?? '';
  const method = req.method ?? '';

  if (method !== 'POST') {
    logger.info({ url, method, status: 405 }, 'listener: rejected non-POST');
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end();
    return;
  }

  const taskId = parseTaskIdFromUrl(url);
  if (!taskId) {
    logger.info({ url, status: 404 }, 'listener: bad path');
    res.statusCode = 404;
    res.end();
    return;
  }

  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    logger.info({ url, contentType, status: 415 }, 'listener: non-JSON content-type');
    res.statusCode = 415;
    res.end();
    return;
  }

  // Per-task rate limit applied before signature verification so an attacker
  // can't burn CPU on HMAC computations for unknown task ids.
  const now = Date.now();
  if (isRateLimited(taskId, now)) {
    logger.info({ taskId, status: 429 }, 'listener: rate limited');
    res.statusCode = 429;
    res.setHeader('retry-after', '1');
    res.end();
    return;
  }

  const lookup = opts.lookupTaskSecret(taskId);
  if (!lookup) {
    logger.info({ taskId, status: 404 }, 'listener: unknown task');
    res.statusCode = 404;
    res.end();
    return;
  }

  const body = await readBodyAsString(req);
  if (body === null) {
    logger.info({ taskId, status: 413 }, 'listener: body too large or read failed');
    res.statusCode = 413;
    res.end();
    return;
  }

  const sigHeader = req.headers[SIGNATURE_HEADER];
  const sigStr = Array.isArray(sigHeader) ? (sigHeader[0] ?? '') : (sigHeader ?? '');
  if (!verifySignature(body, sigStr, lookup.secret)) {
    logger.warn({ taskId, status: 401 }, 'listener: invalid signature');
    res.statusCode = 401;
    res.end();
    return;
  }

  let parsedBody: unknown = null;
  if (body.length > 0) {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      logger.info({ taskId, status: 400 }, 'listener: invalid JSON body');
      res.statusCode = 400;
      res.end();
      return;
    }
  }

  recordTriggerAt(taskId, now);
  try {
    await opts.onTrigger({ taskId, kind: lookup.kind, body: parsedBody });
  } catch (err) {
    logger.warn(
      { taskId, err: err instanceof Error ? err.message : String(err) },
      'listener: onTrigger threw',
    );
    res.statusCode = 500;
    res.end();
    return;
  }

  logger.info({ taskId, kind: lookup.kind, status: 202 }, 'listener: trigger accepted');
  res.statusCode = 202;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ accepted: true }));
}

// Test-only helpers
export function __resetListenerForTests(): void {
  server = null;
  boundPort = null;
  lastTriggerAt.clear();
}

export function __getLastTriggerAtSizeForTests(): number {
  return lastTriggerAt.size;
}

export function __recordTriggerAtForTests(taskId: string, ts: number): void {
  recordTriggerAt(taskId, ts);
}
