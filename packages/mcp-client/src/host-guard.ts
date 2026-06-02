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
  // RFC1918 private ranges. Loopback (127.0.0.0/8) is deliberately NOT blocked:
  // local-first MCP servers commonly bind to 127.0.0.1. LAN hosts, however, are
  // classic SSRF targets (router admin panels, internal services) and must be
  // opt-in via an explicit allowlist.
  if (a === 10) return 'private IPv4 (RFC1918 10.0.0.0/8)';
  if (a === 172 && b >= 16 && b <= 31) return 'private IPv4 (RFC1918 172.16.0.0/12)';
  if (a === 192 && b === 168) return 'private IPv4 (RFC1918 192.168.0.0/16)';
  return null;
}

function isUniqueLocalIpv6(host: string): boolean {
  // IPv6 unique-local addresses fc00::/7 (fc00: – fdff:). Loopback ::1 is left
  // allowed for the same local-first reason as 127.0.0.0/8.
  const inner = stripBrackets(host).toLowerCase();
  return /^f[cd][0-9a-f]{0,2}:/.test(inner);
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

  if (isUniqueLocalIpv6(hostname)) {
    throw new DisallowedMcpHostError(hostname, rawUrl, 'unique-local IPv6 (fc00::/7)');
  }

  return parsed;
}
