import { describe, expect, it, vi } from 'vitest';
import { probeOllama } from './ollama-probe';

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
    const result = await probeOllama(undefined, fetchImpl);
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
    const result = await probeOllama(undefined, fetchImpl);
    expect(result.running).toBe(true);
    expect(result.models[0]?.id).toBe('phi3:mini');
  });

  it('returns running:false on non-2xx response', async () => {
    const fetchImpl = makeFetchStatus(503);
    const result = await probeOllama(undefined, fetchImpl);
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toContain('HTTP 503');
  });

  it('returns running:false when fetch throws (connection refused)', async () => {
    const fetchImpl = makeFetchThrows(new Error('ECONNREFUSED'));
    const result = await probeOllama(undefined, fetchImpl);
    expect(result.running).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns running:true with empty models when payload omits models', async () => {
    const fetchImpl = makeFetchOk({});
    const result = await probeOllama(undefined, fetchImpl);
    expect(result.running).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('skips malformed model entries (missing name and model)', async () => {
    const fetchImpl = makeFetchOk({
      models: [{ size: 123 }, { name: 'good:tag', size: 1000 }],
    });
    const result = await probeOllama(undefined, fetchImpl);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.id).toBe('good:tag');
  });
});
