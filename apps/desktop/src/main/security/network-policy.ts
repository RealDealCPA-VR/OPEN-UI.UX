import { DEFAULT_NETWORK_ALLOWLIST, type NetworkPolicy } from '../../shared/network-policy';

export class LocalOnlyBlockedError extends Error {
  readonly code = 'LOCAL_ONLY_BLOCKED' as const;
  readonly hostname: string;
  constructor(hostname: string) {
    super(
      `Outbound request to "${hostname}" blocked by Local Only mode. ` +
        `Disable Local Only or add this host to the network allowlist in Settings → Privacy.`,
    );
    this.name = 'LocalOnlyBlockedError';
    this.hostname = hostname;
  }
}

export class NetworkAllowlistBlockedError extends Error {
  readonly code = 'NETWORK_ALLOWLIST_BLOCKED' as const;
  readonly hostname: string;
  constructor(hostname: string) {
    super(
      `Outbound request to "${hostname}" blocked by the network allowlist. ` +
        `Add this host to the allowlist in Settings → Privacy.`,
    );
    this.name = 'NetworkAllowlistBlockedError';
    this.hostname = hostname;
  }
}

let cached: NetworkPolicy = {
  localOnlyMode: false,
  allowlist: [...DEFAULT_NETWORK_ALLOWLIST],
};

type Listener = (policy: NetworkPolicy) => void;
const listeners = new Set<Listener>();

export function snapshotNetworkPolicy(): NetworkPolicy {
  return { localOnlyMode: cached.localOnlyMode, allowlist: [...cached.allowlist] };
}

export function setNetworkPolicyCache(policy: NetworkPolicy): void {
  cached = { localOnlyMode: policy.localOnlyMode, allowlist: [...policy.allowlist] };
  for (const fn of listeners) {
    try {
      fn(snapshotNetworkPolicy());
    } catch {
      // listeners must not break the policy update
    }
  }
}

export function onNetworkPolicyChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const LOCAL_ONLY_BASE: readonly string[] = ['127.0.0.1', 'localhost', '*.local'] as const;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return true;
  }
  if (host.startsWith('127.')) return true;
  return false;
}

export function hostMatchesEntry(hostname: string, entry: string): boolean {
  const host = hostname.toLowerCase();
  const pat = entry.toLowerCase();
  if (pat.startsWith('*.')) {
    const base = pat.slice(2);
    if (base.length === 0) return false;
    return host === base || host.endsWith('.' + base);
  }
  return host === pat;
}

export function hostMatchesAnyEntry(hostname: string, entries: readonly string[]): boolean {
  for (const e of entries) {
    if (hostMatchesEntry(hostname, e)) return true;
  }
  return false;
}

export interface OutboundCheck {
  allowed: boolean;
  reason: 'local-only' | 'allowlist' | 'ok';
}

export function checkOutbound(url: string, policy?: NetworkPolicy): OutboundCheck {
  const p = policy ?? cached;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'allowlist' };
  }
  const host = parsed.hostname;
  if (p.localOnlyMode) {
    if (isLoopbackHost(host) || hostMatchesAnyEntry(host, LOCAL_ONLY_BASE)) {
      return { allowed: true, reason: 'ok' };
    }
    return { allowed: false, reason: 'local-only' };
  }
  if (p.allowlist.length === 0) return { allowed: true, reason: 'ok' };
  if (isLoopbackHost(host)) return { allowed: true, reason: 'ok' };
  if (hostMatchesAnyEntry(host, p.allowlist)) return { allowed: true, reason: 'ok' };
  return { allowed: false, reason: 'allowlist' };
}

export function isOutboundAllowed(url: string, policy?: NetworkPolicy): boolean {
  return checkOutbound(url, policy).allowed;
}

export function assertOutboundAllowed(url: string, policy?: NetworkPolicy): void {
  const check = checkOutbound(url, policy);
  if (check.allowed) return;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  if (check.reason === 'local-only') throw new LocalOnlyBlockedError(host);
  throw new NetworkAllowlistBlockedError(host);
}

function normalizeEntry(entry: string): string {
  return entry.trim().toLowerCase();
}

export function addAllowlistEntry(current: readonly string[], entry: string): string[] {
  const normalized = normalizeEntry(entry);
  if (normalized.length === 0) return [...current];
  if (current.some((e) => e.toLowerCase() === normalized)) return [...current];
  return [...current, normalized];
}

export function removeAllowlistEntry(current: readonly string[], entry: string): string[] {
  const normalized = normalizeEntry(entry);
  return current.filter((e) => e.toLowerCase() !== normalized);
}
