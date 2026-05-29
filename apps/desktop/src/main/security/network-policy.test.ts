import { describe, expect, it } from 'vitest';
import {
  addAllowlistEntry,
  assertOutboundAllowed,
  checkOutbound,
  hostMatchesAnyEntry,
  hostMatchesEntry,
  isLoopbackHost,
  isOutboundAllowed,
  LocalOnlyBlockedError,
  NetworkAllowlistBlockedError,
  removeAllowlistEntry,
  setNetworkPolicyCache,
} from './network-policy';

describe('hostMatchesEntry', () => {
  it('matches exact hostname (case-insensitive)', () => {
    expect(hostMatchesEntry('api.example.com', 'api.example.com')).toBe(true);
    expect(hostMatchesEntry('API.Example.COM', 'api.example.com')).toBe(true);
    expect(hostMatchesEntry('other.example.com', 'api.example.com')).toBe(false);
  });

  it('matches wildcard subdomain prefix', () => {
    expect(hostMatchesEntry('a.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesEntry('b.c.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesEntry('example.com', '*.example.com')).toBe(true);
    expect(hostMatchesEntry('evilexample.com', '*.example.com')).toBe(false);
  });

  it('rejects malformed wildcard patterns', () => {
    expect(hostMatchesEntry('anything', '*.')).toBe(false);
  });
});

describe('hostMatchesAnyEntry', () => {
  it('returns true if any entry matches', () => {
    expect(hostMatchesAnyEntry('foo.local', ['localhost', '*.local'])).toBe(true);
    expect(hostMatchesAnyEntry('example.org', ['localhost', '*.local'])).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('detects loopback variants', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LocalHost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.99')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('8.8.8.8')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('detects IPv4-mapped IPv6 loopback', () => {
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::FFFF:127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::ffff:127.1.2.3')).toBe(true);
    expect(isLoopbackHost('[::ffff:127.0.0.1]')).toBe(true);
    expect(isLoopbackHost('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('checkOutbound (Local Only mode)', () => {
  it('allows loopback and *.local under local-only', () => {
    const policy = { localOnlyMode: true, allowlist: [] };
    expect(checkOutbound('http://127.0.0.1:11434', policy).allowed).toBe(true);
    expect(checkOutbound('http://localhost:8080/v1', policy).allowed).toBe(true);
    expect(checkOutbound('http://my-printer.local/api', policy).allowed).toBe(true);
  });

  it('blocks any non-local host under local-only, even if in allowlist', () => {
    const policy = {
      localOnlyMode: true,
      allowlist: ['api.openai.com', '*.anthropic.com'],
    };
    const denied = checkOutbound('https://api.openai.com/v1', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('local-only');
    const denied2 = checkOutbound('https://api.anthropic.com/v1/messages', policy);
    expect(denied2.allowed).toBe(false);
    expect(denied2.reason).toBe('local-only');
  });

  it('blocks malformed URLs', () => {
    const policy = { localOnlyMode: true, allowlist: [] };
    expect(checkOutbound('not a url', policy).allowed).toBe(false);
  });
});

describe('checkOutbound (allowlist mode)', () => {
  it('allows loopback by default even with restrictive allowlist', () => {
    const policy = { localOnlyMode: false, allowlist: ['api.openai.com'] };
    expect(checkOutbound('http://127.0.0.1:11434', policy).allowed).toBe(true);
  });

  it('allows hosts that match the allowlist', () => {
    const policy = {
      localOnlyMode: false,
      allowlist: ['api.openai.com', '*.anthropic.com'],
    };
    expect(checkOutbound('https://api.openai.com/v1', policy).allowed).toBe(true);
    expect(checkOutbound('https://api.anthropic.com/v1/messages', policy).allowed).toBe(true);
    expect(checkOutbound('https://staging.api.anthropic.com/x', policy).allowed).toBe(true);
  });

  it('blocks hosts not in allowlist', () => {
    const policy = { localOnlyMode: false, allowlist: ['api.openai.com'] };
    const denied = checkOutbound('https://evil.example.com/x', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('allowlist');
  });

  it('treats empty allowlist as "allow all" (legacy behavior)', () => {
    const policy = { localOnlyMode: false, allowlist: [] };
    expect(checkOutbound('https://anything.invalid/', policy).allowed).toBe(true);
  });
});

describe('assertOutboundAllowed', () => {
  it('throws LocalOnlyBlockedError under local-only', () => {
    const policy = { localOnlyMode: true, allowlist: [] };
    expect(() => assertOutboundAllowed('https://api.openai.com/v1', policy)).toThrow(
      LocalOnlyBlockedError,
    );
  });

  it('throws NetworkAllowlistBlockedError when not in allowlist', () => {
    const policy = { localOnlyMode: false, allowlist: ['api.openai.com'] };
    expect(() => assertOutboundAllowed('https://evil.example.com', policy)).toThrow(
      NetworkAllowlistBlockedError,
    );
  });

  it('returns void on success', () => {
    const policy = { localOnlyMode: false, allowlist: ['api.openai.com'] };
    expect(() => assertOutboundAllowed('https://api.openai.com/v1', policy)).not.toThrow();
  });
});

describe('addAllowlistEntry / removeAllowlistEntry', () => {
  it('adds a new entry (lowercased) and avoids duplicates', () => {
    const a = addAllowlistEntry(['api.openai.com'], 'Api.Anthropic.COM');
    expect(a).toEqual(['api.openai.com', 'api.anthropic.com']);
    const b = addAllowlistEntry(a, 'api.openai.com');
    expect(b).toEqual(['api.openai.com', 'api.anthropic.com']);
  });

  it('ignores empty entries', () => {
    expect(addAllowlistEntry(['x'], '   ')).toEqual(['x']);
  });

  it('removes entry case-insensitively', () => {
    const r = removeAllowlistEntry(['api.openai.com', 'api.anthropic.com'], 'API.OPENAI.COM');
    expect(r).toEqual(['api.anthropic.com']);
  });

  it('is a no-op if the entry does not exist', () => {
    expect(removeAllowlistEntry(['a'], 'b')).toEqual(['a']);
  });
});

describe('module cache + isOutboundAllowed convenience', () => {
  it('uses the cached policy when none is passed', () => {
    setNetworkPolicyCache({
      localOnlyMode: true,
      allowlist: ['api.openai.com'],
    });
    expect(isOutboundAllowed('http://localhost:11434')).toBe(true);
    expect(isOutboundAllowed('https://api.openai.com/v1')).toBe(false);
    setNetworkPolicyCache({
      localOnlyMode: false,
      allowlist: ['api.openai.com'],
    });
    expect(isOutboundAllowed('https://api.openai.com/v1')).toBe(true);
    expect(isOutboundAllowed('https://evil.example.com/x')).toBe(false);
  });
});
