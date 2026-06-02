import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpTransport } from './http-transport';
import { SseTransport } from './sse-transport';
import { DisallowedMcpHostError } from './host-guard';

describe('HttpTransport host guard', () => {
  it('refuses to construct against 0.0.0.0', () => {
    expect(() => new HttpTransport({ kind: 'http', url: 'http://0.0.0.0/mcp' })).toThrow(
      DisallowedMcpHostError,
    );
  });

  it('refuses to construct against AWS metadata endpoint', () => {
    expect(() => new HttpTransport({ kind: 'http', url: 'http://169.254.169.254/mcp' })).toThrow(
      DisallowedMcpHostError,
    );
  });

  it('refuses hosts outside allowlist when one is provided', () => {
    expect(
      () =>
        new HttpTransport({
          kind: 'http',
          url: 'https://untrusted.example.com/mcp',
          hostAllowlist: ['api.example.com'],
        }),
    ).toThrow(DisallowedMcpHostError);
  });

  it('accepts hosts on the allowlist', () => {
    const t = new HttpTransport({
      kind: 'http',
      url: 'https://api.example.com/mcp',
      hostAllowlist: ['api.example.com'],
    });
    expect(t.kind).toBe('http');
  });
});

describe('SseTransport host guard', () => {
  it('refuses to construct against link-local IPv6', () => {
    expect(() => new SseTransport({ kind: 'sse', url: 'http://[fe80::1]/mcp' })).toThrow(
      DisallowedMcpHostError,
    );
  });

  it('refuses hosts outside allowlist when one is provided', () => {
    expect(
      () =>
        new SseTransport({
          kind: 'sse',
          url: 'https://other.example.com/sse',
          hostAllowlist: ['mcp.example.com'],
        }),
    ).toThrow(DisallowedMcpHostError);
  });
});

describe('transport SSRF redirect hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okResponse(): Response {
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('HttpTransport.send rejects following redirects (redirect: error)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    const t = new HttpTransport({ kind: 'http', url: 'https://api.example.com/mcp' });
    await t.start();
    await t.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
  });

  it('SseTransport.start fetch rejects following redirects (redirect: error)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const t = new SseTransport({ kind: 'sse', url: 'https://mcp.example.com/sse' });
    await t.start();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
    await t.stop();
  });
});
