export class DisallowedMcpHostError extends Error {
  constructor(
    public readonly host: string,
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`MCP host "${host}" rejected: ${reason} (url=${url})`);
    this.name = 'DisallowedMcpHostError';
  }
}

const BLOCKED_LITERAL_HOSTS: ReadonlySet<string> = new Set([
  '0.0.0.0',
  '::',
  '[::]',
  '169.254.169.254',
  '[fe80::a9fe:a9fe]',
  'metadata.google.internal',
  'metadata',
]);

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function ipv4Octets(host: string): readonly [number, number, number, number] | null {
  if (!isIpv4Literal(host)) return null;
  const parts = host.split('.').map((s) => Number(s));
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!Number.isInteger(p) || p < 0 || p > 255) return null;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return [a, b, c, d];
}

function isPrivateOrLinkLocalIpv4(host: string): string | null {
  const octets = ipv4Octets(host);
  if (!octets) return null;
  const [a, b] = octets;
  if (a === 169 && b === 254) return 'link-local IPv4';
  if (a === 0) return 'unspecified IPv4';
  return null;
}

function stripBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function isLinkLocalIpv6(host: string): boolean {
  const inner = stripBrackets(host).toLowerCase();
  return inner.startsWith('fe80:') || inner.startsWith('fe80::');
}

export interface HostGuardOptions {
  allowlist?: readonly string[];
}

export function assertHostAllowed(rawUrl: string, options: HostGuardOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DisallowedMcpHostError(rawUrl, rawUrl, 'invalid URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowlist = options.allowlist?.map((h) => h.toLowerCase()) ?? [];

  if (allowlist.length > 0) {
    if (!allowlist.includes(hostname)) {
      throw new DisallowedMcpHostError(hostname, rawUrl, 'host not in allowlist');
    }
    return parsed;
  }

  if (BLOCKED_LITERAL_HOSTS.has(hostname)) {
    throw new DisallowedMcpHostError(hostname, rawUrl, 'blocked literal host');
  }

  const ipv4Reason = isPrivateOrLinkLocalIpv4(hostname);
  if (ipv4Reason) {
    throw new DisallowedMcpHostError(hostname, rawUrl, ipv4Reason);
  }

  if (isLinkLocalIpv6(hostname)) {
    throw new DisallowedMcpHostError(hostname, rawUrl, 'link-local IPv6');
  }

  return parsed;
}
