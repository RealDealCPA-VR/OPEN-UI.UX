import { describe, expect, it, vi } from 'vitest';
import { fetchPluginRegistry, type FetchImpl } from './registry-fetcher';

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function fetchOk(body: unknown): FetchImpl {
  return vi.fn(async () => mockResponse(body));
}

describe('fetchPluginRegistry', () => {
  it('parses a versioned envelope', async () => {
    const entry = {
      name: 'cool-plugin',
      version: '1.0.0',
      displayName: 'Cool Plugin',
      installUrl: 'https://example.com/cool.tgz',
      permissions: ['workspace.read'],
      contributions: { tools: ['cool_tool'] },
    };
    const result = await fetchPluginRegistry(
      'https://registry/',
      fetchOk({ schemaVersion: 1, entries: [entry] }),
    );
    expect(result.error).toBeNull();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.name).toBe('cool-plugin');
  });

  it('accepts a bare array (legacy shape) and skips invalid entries', async () => {
    const valid = {
      name: 'good',
      version: '0.1.0',
      displayName: 'Good',
      installUrl: 'https://example.com/g.tgz',
    };
    const invalid = { name: 'missing-rest' };
    const result = await fetchPluginRegistry('https://r/', fetchOk([valid, invalid]));
    expect(result.error).toBeNull();
    expect(result.entries.map((e) => e.name)).toEqual(['good']);
  });

  it('returns error on HTTP failure', async () => {
    const fetcher: FetchImpl = async () => mockResponse({}, false, 503);
    const result = await fetchPluginRegistry('https://x/', fetcher);
    expect(result.error).toBe('HTTP 503');
    expect(result.entries).toEqual([]);
  });

  it('returns error on Zod validation failure for envelope', async () => {
    const result = await fetchPluginRegistry(
      'https://r/',
      fetchOk({ schemaVersion: 1, entries: 'not an array' }),
    );
    expect(result.error).toMatch(/invalid registry shape/);
    expect(result.entries).toEqual([]);
  });

  it('returns error when fetch itself throws', async () => {
    const fetcher: FetchImpl = async () => {
      throw new Error('network down');
    };
    const result = await fetchPluginRegistry('https://r/', fetcher);
    expect(result.error).toBe('network down');
    expect(result.entries).toEqual([]);
  });

  it('preserves signature and signer fields for downstream verification', async () => {
    const entry = {
      name: 'signed',
      version: '1.0.0',
      displayName: 'Signed',
      installUrl: 'https://example.com/s.tgz',
      signature: 'abc123==',
      signer: 'opencodex-official',
    };
    const result = await fetchPluginRegistry('https://r/', fetchOk([entry]));
    expect(result.entries[0]?.signature).toBe('abc123==');
    expect(result.entries[0]?.signer).toBe('opencodex-official');
  });
});
