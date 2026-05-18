import { describe, expect, it, vi } from 'vitest';
import { ping } from './ping';
import type { PingSpec } from './catalog';

const spec: PingSpec = {
  url: 'https://example.com/models',
  method: 'GET',
  headers: { authorization: 'Bearer test' },
  expectsAuth: true,
};

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  });
}

describe('ping', () => {
  it('returns ok on 2xx', async () => {
    const fetchImpl = stubFetch(() => new Response('[]', { status: 200 }));
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('ok');
    expect(result.httpStatus).toBe(200);
  });

  it('classifies 401 as auth failure', async () => {
    const fetchImpl = stubFetch(() => new Response('unauthorized', { status: 401 }));
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('auth');
    expect(result.httpStatus).toBe(401);
  });

  it('classifies 403 as auth failure', async () => {
    const fetchImpl = stubFetch(() => new Response('forbidden', { status: 403 }));
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(result.code).toBe('auth');
  });

  it('classifies other 4xx/5xx as http', async () => {
    const fetchImpl = stubFetch(() => new Response('boom', { status: 500 }));
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(result.code).toBe('http');
    expect(result.httpStatus).toBe(500);
  });

  it('classifies thrown errors as network', async () => {
    const fetchImpl = stubFetch(() => {
      throw new Error('ENOTFOUND example.com');
    });
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(result.code).toBe('network');
    expect(result.message).toContain('ENOTFOUND');
  });

  it('reports timeout when the abort signal fires', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const result = await ping(spec, { fetch: fetchImpl as unknown as typeof fetch, timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('timeout');
  });

  it('passes the request method and headers through to fetch', async () => {
    const fetchImpl = stubFetch(() => new Response('ok', { status: 200 }));
    await ping(spec, { fetch: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/models',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer test' },
      }),
    );
  });
});
