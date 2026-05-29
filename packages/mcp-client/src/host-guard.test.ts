import { describe, expect, it } from 'vitest';
import { assertHostAllowed, DisallowedMcpHostError } from './host-guard';

describe('host-guard', () => {
  it('blocks 0.0.0.0', () => {
    expect(() => assertHostAllowed('http://0.0.0.0/mcp')).toThrow(DisallowedMcpHostError);
  });

  it('blocks AWS-style metadata IP 169.254.169.254', () => {
    expect(() => assertHostAllowed('http://169.254.169.254/latest/meta-data')).toThrow(
      DisallowedMcpHostError,
    );
  });

  it('blocks link-local IPv4 (169.254.x.x)', () => {
    expect(() => assertHostAllowed('http://169.254.1.1/x')).toThrow(DisallowedMcpHostError);
  });

  it('blocks IPv6 link-local', () => {
    expect(() => assertHostAllowed('http://[fe80::1]/x')).toThrow(DisallowedMcpHostError);
  });

  it('blocks GCP metadata.google.internal alias', () => {
    expect(() => assertHostAllowed('http://metadata.google.internal/x')).toThrow(
      DisallowedMcpHostError,
    );
  });

  it('allows ordinary public hosts when no allowlist is provided', () => {
    const url = assertHostAllowed('https://api.example.com/mcp');
    expect(url.hostname).toBe('api.example.com');
  });

  it('enforces allowlist when provided (rejects hosts not in list)', () => {
    expect(() =>
      assertHostAllowed('https://other.example.com/mcp', { allowlist: ['api.example.com'] }),
    ).toThrow(DisallowedMcpHostError);
  });

  it('allows hosts on the allowlist', () => {
    const url = assertHostAllowed('https://api.example.com/mcp', {
      allowlist: ['api.example.com'],
    });
    expect(url.hostname).toBe('api.example.com');
  });

  it('rejects malformed URLs', () => {
    expect(() => assertHostAllowed('not a url')).toThrow(DisallowedMcpHostError);
  });
});
