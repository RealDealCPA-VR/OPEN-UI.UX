import { describe, expect, it, vi } from 'vitest';
import { probeOllama, resolveOllamaBaseUrl } from './ollama-probe';

const PROBE_OPTS = { skipConfiguredBaseUrl: true, envHost: undefined } as const;

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function makeFetchStatus(status: number): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

function makeFetchThrows(err: Error): typeof fetch {
  return vi.fn(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

describe('probeOllama', () => {
  it('returns running:true with mapped models when fetch succeeds', async () => {
    const fetchImpl = makeFetchOk({
      models: [
        { name: 'llama3:8b', size: 4_700_000_000 },
        { name: 'qwen2.5-coder:7b', size: 4_500_000_000 },
      ],
    });
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]?.id).toBe('llama3:8b');
    expect(result.models[0]?.sizeGb).toBeGreaterThan(4);
    expect(result.models[0]?.sizeGb).toBeLessThan(5);
  });

  it('accepts entries that use "model" instead of "name"', async () => {
    const fetchImpl = makeFetchOk({
      models: [{ model: 'phi3:mini', size: 2_100_000_000 }],
    });
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(true);
    expect(result.models[0]?.id).toBe('phi3:mini');
  });

  it('returns running:false on non-2xx response', async () => {
    const fetchImpl = makeFetchStatus(503);
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('HTTP 503');
  });

  it('returns running:false when fetch throws (connection refused)', async () => {
    const fetchImpl = makeFetchThrows(new Error('ECONNREFUSED'));
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns running:true with empty models when payload omits models', async () => {
    const fetchImpl = makeFetchOk({});
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('skips malformed model entries (missing name and model)', async () => {
    const fetchImpl = makeFetchOk({
      models: [{ size: 123 }, { name: 'good:tag', size: 1000 }],
    });
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.id).toBe('good:tag');
  });

  it('returns running:true with empty models when payload is not an object', async () => {
    const fetchImpl = makeFetchOk('not-json-object');
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('returns running:true with empty models when models is not an array', async () => {
    const fetchImpl = makeFetchOk({ models: 'oops' });
    const result = await probeOllama(undefined, fetchImpl, PROBE_OPTS);
    expect(result.running).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('honours OLLAMA_HOST when no provider baseUrl is configured', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ models: [] }) };
    }) as unknown as typeof fetch;
    await probeOllama(undefined, fetchImpl, {
      skipConfiguredBaseUrl: true,
      envHost: 'remote.local:9999',
    });
    expect(calls[0]).toBe('http://remote.local:9999/api/tags');
  });

  it('explicit baseUrl override beats env', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ models: [] }) };
    }) as unknown as typeof fetch;
    await probeOllama(undefined, fetchImpl, {
      skipConfiguredBaseUrl: true,
      envHost: 'remote.local:9999',
      baseUrl: 'http://explicit.example:1234',
    });
    expect(calls[0]).toBe('http://explicit.example:1234/api/tags');
  });

  it('falls back to localhost when the configured IPv6 base refuses the connection', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.startsWith('http://[::1]')) {
        throw new Error('connect ECONNREFUSED ::1:11434');
      }
      return { ok: true, status: 200, json: async () => ({ models: [] }) };
    }) as unknown as typeof fetch;
    const result = await probeOllama(undefined, fetchImpl, {
      skipConfiguredBaseUrl: true,
      envHost: '[::1]:11434',
    });
    expect(result.running).toBe(true);
    expect(calls[0]).toBe('http://[::1]:11434/api/tags');
    expect(calls[1]).toBe('http://127.0.0.1:11434/api/tags');
  });
});

describe('resolveOllamaBaseUrl', () => {
  it('returns default localhost when nothing is configured', () => {
    expect(resolveOllamaBaseUrl({})).toBe('http://127.0.0.1:11434');
  });
  it('prefers configuredBaseUrl over envHost', () => {
    expect(
      resolveOllamaBaseUrl({
        configuredBaseUrl: 'http://from-settings:1',
        envHost: 'from-env:2',
      }),
    ).toBe('http://from-settings:1');
  });
  it('normalises a bare host:port from OLLAMA_HOST', () => {
    expect(resolveOllamaBaseUrl({ envHost: 'remote:11434' })).toBe('http://remote:11434');
  });
  it('strips a trailing slash', () => {
    expect(resolveOllamaBaseUrl({ configuredBaseUrl: 'http://x.example/' })).toBe(
      'http://x.example',
    );
  });
});
