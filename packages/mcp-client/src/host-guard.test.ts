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

  it('blocks RFC1918 10.0.0.0/8', () => {
    expect(() => assertHostAllowed('http://10.0.0.1/x')).toThrow(DisallowedMcpHostError);
  });

  it('blocks RFC1918 172.16.0.0/12 (in range)', () => {
    expect(() => assertHostAllowed('http://172.16.5.4/x')).toThrow(DisallowedMcpHostError);
    expect(() => assertHostAllowed('http://172.31.255.255/x')).toThrow(DisallowedMcpHostError);
  });

  it('allows 172.x outside the RFC1918 16-31 band', () => {
    expect(assertHostAllowed('http://172.15.0.1/x').hostname).toBe('172.15.0.1');
    expect(assertHostAllowed('http://172.32.0.1/x').hostname).toBe('172.32.0.1');
  });

  it('blocks RFC1918 192.168.0.0/16', () => {
    expect(() => assertHostAllowed('http://192.168.1.1/admin')).toThrow(DisallowedMcpHostError);
  });

  it('blocks IPv6 unique-local fc00::/7', () => {
    expect(() => assertHostAllowed('http://[fc00::1]/x')).toThrow(DisallowedMcpHostError);
    expect(() => assertHostAllowed('http://[fd12:3456::1]/x')).toThrow(DisallowedMcpHostError);
  });

  it('still allows loopback 127.0.0.1 (local-first MCP servers)', () => {
    expect(assertHostAllowed('http://127.0.0.1:8080/mcp').hostname).toBe('127.0.0.1');
  });

  it('still allows IPv6 loopback ::1', () => {
    expect(assertHostAllowed('http://[::1]:8080/mcp').hostname).toBe('[::1]');
  });

  it('allows a blocked private host when it is explicitly allowlisted', () => {
    expect(
      assertHostAllowed('http://192.168.1.1/admin', { allowlist: ['192.168.1.1'] }).hostname,
    ).toBe('192.168.1.1');
  });
});
