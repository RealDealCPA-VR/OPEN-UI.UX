import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRegistryFetcherForTest,
  __setRegistryFetcherForTest,
  clearRegistryCache,
  fetchMcpRegistry,
  getCachedRegistry,
} from './registry-fetcher';

function jsonResponse(body: unknown, init?: { status?: number; contentType?: string }): Response {
  const headers = new Headers({
    'content-type': init?.contentType ?? 'application/json',
  });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init?.status ?? 200,
    headers,
  });
}

describe('registry-fetcher', () => {
  beforeEach(() => {
    __resetRegistryFetcherForTest();
    clearRegistryCache();
  });
  afterEach(() => {
    __resetRegistryFetcherForTest();
  });

  it('fetches and validates a registry payload', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 'filesystem',
          displayName: 'Filesystem',
          description: 'Read and write files.',
          template: {
            id: 'filesystem',
            displayName: 'Filesystem',
            config: { kind: 'stdio', command: 'npx', args: [] },
          },
        },
      ]),
    );
    __setRegistryFetcherForTest({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    const res = await fetchMcpRegistry('https://example.com/registry.json');
    expect(res.error).toBeNull();
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.id).toBe('filesystem');
    expect(res.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts envelope { entries: [...] } shape', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        entries: [
          {
            id: 'github',
            displayName: 'GitHub',
            description: 'GitHub server',
            template: {
              id: 'github',
              displayName: 'GitHub',
              config: { kind: 'stdio', command: 'npx', args: [] },
            },
          },
        ],
      }),
    );
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry('https://example.com/registry.json');
    expect(res.error).toBeNull();
    expect(res.entries[0]?.id).toBe('github');
  });

  it('returns cached results within TTL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 'cached',
          displayName: 'Cached',
          description: 'desc',
          template: {
            id: 'cached',
            displayName: 'Cached',
            config: { kind: 'stdio', command: 'x', args: [] },
          },
        },
      ]),
    );
    let now = 0;
    __setRegistryFetcherForTest({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    now = 1000;
    const first = await fetchMcpRegistry('https://example.com/registry.json');
    expect(first.cached).toBe(false);

    now = 1000 + 5 * 60 * 1000;
    const second = await fetchMcpRegistry('https://example.com/registry.json');
    expect(second.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getCachedRegistry()?.entries[0]?.id).toBe('cached');
  });

  it('refetches after TTL expires', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 'a',
          displayName: 'A',
          description: 'a',
          template: {
            id: 'a',
            displayName: 'A',
            config: { kind: 'stdio', command: 'x', args: [] },
          },
        },
      ]),
    );
    let now = 0;
    __setRegistryFetcherForTest({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    now = 1000;
    await fetchMcpRegistry('https://example.com/registry.json');
    now = 1000 + 16 * 60 * 1000;
    const refetched = await fetchMcpRegistry('https://example.com/registry.json');
    expect(refetched.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refetches when URL changes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 'x',
          displayName: 'X',
          description: 'x',
          template: {
            id: 'x',
            displayName: 'X',
            config: { kind: 'stdio', command: 'x', args: [] },
          },
        },
      ]),
    );
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0 });

    await fetchMcpRegistry('https://example.com/a.json');
    await fetchMcpRegistry('https://example.com/b.json');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the default URL when null is passed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry(null);
    expect(res.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    expect(String(firstCall?.[0])).toContain('opencodex.dev/mcp-registry.json');
  });

  it('reports HTTP errors without caching', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('nope', { status: 503 }));
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry('https://example.com/r.json');
    expect(res.error).toBe('HTTP 503');
    expect(getCachedRegistry()).toBeNull();
  });

  it('rejects non-JSON content-type', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse('<html></html>', { contentType: 'text/html' }),
    );
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry('https://example.com/r.json');
    expect(res.error).toContain('unexpected content-type');
  });

  it('rejects malformed schema', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ id: 'x', displayName: 'X', description: 'd' }]),
    );
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry('https://example.com/r.json');
    expect(res.error).toContain('schema mismatch');
  });

  it('reports network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('econnrefused');
    });
    __setRegistryFetcherForTest({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await fetchMcpRegistry('https://example.com/r.json');
    expect(res.error).toBe('econnrefused');
    expect(getCachedRegistry()).toBeNull();
  });
});
