import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/codebase-index', () => ({
  upsertIndexedFile: vi.fn(),
  removeIndexedFile: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./manager', () => ({
  getAvailableResources: vi.fn(() => []),
  getClientForServer: vi.fn(() => null),
  onMcpServerConnected: vi.fn(() => () => undefined),
}));

import type { McpClient, McpReadResourceResult } from '@opencodex/mcp-client';
import type { McpResourceEntry } from '../../shared/mcp';
import {
  cancelPendingReindex,
  indexAllMcpResources,
  mcpResourceIndexKey,
  parseMcpIndexKey,
  scheduleReindex,
  startMcpResourceAutoIndexing,
} from './resource-indexer';

interface FakeClient {
  readResource: (uri: string) => Promise<McpReadResourceResult>;
}

function makeEntry(serverId: string, uri: string, name = uri): McpResourceEntry {
  return {
    serverId,
    serverDisplayName: serverId,
    resource: { uri, name },
  };
}

function makeClient(responses: Record<string, McpReadResourceResult | Error>): McpClient {
  const fake: FakeClient = {
    readResource: async (uri) => {
      const r = responses[uri];
      if (r instanceof Error) throw r;
      if (!r) throw new Error(`no fixture for ${uri}`);
      return r;
    },
  };
  return fake as unknown as McpClient;
}

describe('mcpResourceIndexKey / parseMcpIndexKey', () => {
  it('round-trips a key', () => {
    const k = mcpResourceIndexKey('srv1', 'file:///a/b.txt');
    expect(k).toBe('mcp:srv1:file:///a/b.txt');
    expect(parseMcpIndexKey(k)).toEqual({ serverId: 'srv1', uri: 'file:///a/b.txt' });
  });

  it('returns null for non-mcp keys', () => {
    expect(parseMcpIndexKey('src/foo.ts')).toBeNull();
  });

  it('returns null for malformed keys', () => {
    expect(parseMcpIndexKey('mcp:')).toBeNull();
    expect(parseMcpIndexKey('mcp::oops')).toBeNull();
  });
});

describe('indexAllMcpResources', () => {
  let upsertSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    upsertSpy = vi.fn();
  });

  it('upserts each resource as text content keyed by mcp:<serverId>:<uri>', async () => {
    const entries = [makeEntry('srv1', 'res://a'), makeEntry('srv1', 'res://b')];
    const client = makeClient({
      'res://a': { contents: [{ uri: 'res://a', text: 'hello world' }] },
      'res://b': { contents: [{ uri: 'res://b', text: 'goodbye world' }] },
    });

    const result = await indexAllMcpResources({
      getAvailableResources: () => entries,
      getClientForServer: () => client,
      upsert: upsertSpy,
      now: () => 12345,
    });

    expect(result.indexed).toBe(2);
    expect(result.failed).toBe(0);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(upsertSpy).toHaveBeenCalledWith(
      'mcp:srv1:res://a',
      'hello world',
      12345,
      Buffer.byteLength('hello world', 'utf8'),
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      'mcp:srv1:res://b',
      'goodbye world',
      12345,
      Buffer.byteLength('goodbye world', 'utf8'),
    );
  });

  it('records a failure when the client is missing', async () => {
    const result = await indexAllMcpResources({
      getAvailableResources: () => [makeEntry('srv1', 'res://a')],
      getClientForServer: () => null,
      upsert: upsertSpy,
    });
    expect(result.indexed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatchObject({ serverId: 'srv1', uri: 'res://a' });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('records a failure when readResource throws but continues with others', async () => {
    const entries = [makeEntry('srv1', 'res://broken'), makeEntry('srv1', 'res://ok')];
    const client = makeClient({
      'res://broken': new Error('boom'),
      'res://ok': { contents: [{ uri: 'res://ok', text: 'fine' }] },
    });

    const result = await indexAllMcpResources({
      getAvailableResources: () => entries,
      getClientForServer: () => client,
      upsert: upsertSpy,
    });

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toContain('boom');
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      'mcp:srv1:res://ok',
      'fine',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('concatenates multiple text content blocks per resource', async () => {
    const client = makeClient({
      'res://multi': {
        contents: [
          { uri: 'res://multi', text: 'part one' },
          { uri: 'res://multi', text: 'part two' },
          { uri: 'res://multi', mimeType: 'image/png', blob: 'AAAA' },
        ],
      },
    });
    await indexAllMcpResources({
      getAvailableResources: () => [makeEntry('srv1', 'res://multi')],
      getClientForServer: () => client,
      upsert: upsertSpy,
      now: () => 1,
    });
    expect(upsertSpy).toHaveBeenCalledWith(
      'mcp:srv1:res://multi',
      'part one\npart two',
      1,
      Buffer.byteLength('part one\npart two', 'utf8'),
    );
  });

  it('does nothing when there are no available resources', async () => {
    const result = await indexAllMcpResources({
      getAvailableResources: () => [],
      getClientForServer: () => null,
      upsert: upsertSpy,
    });
    expect(result).toEqual({ indexed: 0, failed: 0, failures: [] });
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe('scheduleReindex (debounced auto-index)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelPendingReindex();
  });

  afterEach(() => {
    cancelPendingReindex();
    vi.useRealTimers();
  });

  it('coalesces multiple rapid calls into a single index pass', async () => {
    const upsertSpy = vi.fn();
    const getAvailable = vi.fn(() => [makeEntry('srv1', 'res://a')]);
    const client = makeClient({
      'res://a': { contents: [{ uri: 'res://a', text: 'data' }] },
    });

    scheduleReindex({
      getAvailableResources: getAvailable,
      getClientForServer: () => client,
      upsert: upsertSpy,
    });
    scheduleReindex({
      getAvailableResources: getAvailable,
      getClientForServer: () => client,
      upsert: upsertSpy,
    });
    scheduleReindex({
      getAvailableResources: getAvailable,
      getClientForServer: () => client,
      upsert: upsertSpy,
    });

    await vi.advanceTimersByTimeAsync(1100);
    // Drain any microtasks
    await vi.runAllTimersAsync();

    expect(getAvailable).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});

describe('startMcpResourceAutoIndexing', () => {
  it('subscribes to onConnect and schedules a reindex when fired', () => {
    let fired: (() => void) | null = null;
    const fakeOnConnect = (listener: (serverId: string) => void): (() => void) => {
      fired = () => listener('srv1');
      return () => undefined;
    };
    const upsertSpy = vi.fn();
    const stop = startMcpResourceAutoIndexing({
      onConnect: fakeOnConnect,
      getAvailableResources: () => [],
      getClientForServer: () => null,
      upsert: upsertSpy,
    });
    expect(fired).toBeTypeOf('function');
    expect(() => fired?.()).not.toThrow();
    stop();
  });
});
