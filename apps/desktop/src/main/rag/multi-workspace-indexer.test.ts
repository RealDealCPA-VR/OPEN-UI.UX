import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MultiWorkspaceIndexer, type EmbeddingProviderResolver } from './multi-workspace-indexer';
import type { SqliteVectorStore, VectorSearchHit } from './vector-store';
import { WorkspaceWatcher, type WatcherBatch, type WatcherChangeHandler } from './watcher';
import type { WorkspaceEntry } from '../../shared/workspaces';

interface FakeStoreHandle {
  open: Mock;
  close: Mock;
  searchByVector: Mock;
  upsert: Mock;
}

function makeFakeStore(hits: VectorSearchHit[]): {
  store: SqliteVectorStore;
  handle: FakeStoreHandle;
} {
  const handle: FakeStoreHandle = {
    open: vi.fn(),
    close: vi.fn(),
    searchByVector: vi.fn(() => hits),
    upsert: vi.fn(),
  };
  const store = handle as unknown as SqliteVectorStore;
  return { store, handle };
}

class StubWatcher extends WorkspaceWatcher {
  override async start(): Promise<void> {
    /* no-op */
  }
  override async stop(): Promise<void> {
    /* no-op */
  }
}

class CapturingWatcher extends WorkspaceWatcher {
  private captured: WatcherChangeHandler | null = null;
  override async start(_root: string, onChange: WatcherChangeHandler): Promise<void> {
    this.captured = onChange;
  }
  override async stop(): Promise<void> {
    this.captured = null;
  }
  trigger(batch: WatcherBatch): void {
    this.captured?.(batch);
  }
}

function makeWorkspace(id: string, root: string, primary = false): WorkspaceEntry {
  return {
    id,
    path: root,
    displayName: id,
    isPrimary: primary,
    ragEnabled: true,
    createdAt: new Date().toISOString(),
  };
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-mwi-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe('MultiWorkspaceIndexer', () => {
  it('opens a vector store per workspace on start()', async () => {
    const workspaces: WorkspaceEntry[] = [
      makeWorkspace('ws1', path.join(baseDir, 'src1'), true),
      makeWorkspace('ws2', path.join(baseDir, 'src2')),
    ];
    const handles: FakeStoreHandle[] = [];
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => {
        const { store, handle } = makeFakeStore([]);
        handles.push(handle);
        return store;
      },
      listWorkspaces: () => workspaces,
      getWorkspace: (id) => workspaces.find((w) => w.id === id) ?? null,
      watcherFactory: () => new StubWatcher(),
    });
    await indexer.start();

    expect(handles).toHaveLength(2);
    expect(handles[0]?.open).toHaveBeenCalledWith(path.join(baseDir, 'ws1'));
    expect(handles[1]?.open).toHaveBeenCalledWith(path.join(baseDir, 'ws2'));
    expect(indexer.listActiveWorkspaceIds().sort()).toEqual(['ws1', 'ws2']);

    await indexer.stop();
    expect(handles[0]?.close).toHaveBeenCalled();
    expect(handles[1]?.close).toHaveBeenCalled();
  });

  it('skips workspaces with rag disabled', async () => {
    const ws: WorkspaceEntry = {
      ...makeWorkspace('ws1', baseDir, true),
      ragEnabled: false,
    };
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => makeFakeStore([]).store,
      listWorkspaces: () => [ws],
      getWorkspace: (id) => (id === ws.id ? ws : null),
      watcherFactory: () => new StubWatcher(),
    });
    await indexer.start();
    expect(indexer.listActiveWorkspaceIds()).toEqual([]);
  });

  it('returns no hits when workspaceIds list is empty', async () => {
    const ws = makeWorkspace('ws1', baseDir, true);
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => makeFakeStore([]).store,
      listWorkspaces: () => [ws],
      getWorkspace: (id) => (id === ws.id ? ws : null),
      watcherFactory: () => new StubWatcher(),
    });
    await indexer.start();
    expect(indexer.searchAcrossWorkspaces([0.1, 0.2], [], 10)).toEqual([]);
    await indexer.stop();
  });

  it('tags hits with their workspaceId and fuses results across workspaces', async () => {
    const ws1 = makeWorkspace('ws1', path.join(baseDir, 's1'), true);
    const ws2 = makeWorkspace('ws2', path.join(baseDir, 's2'));
    const handles: Record<string, FakeStoreHandle> = {};
    const fixtures: Record<string, VectorSearchHit[]> = {
      ws1: [
        { path: 'a.ts', content: 'A1', score: 0.9, startLine: 1, endLine: 2 },
        { path: 'b.ts', content: 'B1', score: 0.5, startLine: 1, endLine: 2 },
      ],
      ws2: [
        { path: 'a.ts', content: 'A2', score: 0.8, startLine: 1, endLine: 2 },
        { path: 'c.ts', content: 'C2', score: 0.6, startLine: 1, endLine: 2 },
      ],
    };
    const order = ['ws1', 'ws2'];
    let i = 0;
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => {
        const id = order[i++] ?? '';
        const { store, handle } = makeFakeStore(fixtures[id] ?? []);
        handles[id] = handle;
        return store;
      },
      listWorkspaces: () => [ws1, ws2],
      getWorkspace: (id) => [ws1, ws2].find((w) => w.id === id) ?? null,
      watcherFactory: () => new StubWatcher(),
    });
    await indexer.start();

    const hits = indexer.searchAcrossWorkspaces([0.1, 0.2], ['ws1', 'ws2'], 10);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(['ws1', 'ws2']).toContain(h.workspaceId);
    }
    const ws1Hits = hits.filter((h) => h.workspaceId === 'ws1');
    const ws2Hits = hits.filter((h) => h.workspaceId === 'ws2');
    expect(ws1Hits.length).toBeGreaterThan(0);
    expect(ws2Hits.length).toBeGreaterThan(0);
    expect(handles['ws1']?.searchByVector).toHaveBeenCalled();
    expect(handles['ws2']?.searchByVector).toHaveBeenCalled();

    await indexer.stop();
  });

  it('wires watcher batches end-to-end: chunk → embed → upsert', async () => {
    const ws = makeWorkspace('ws1', baseDir, true);
    const captured: CapturingWatcher[] = [];
    const { store: fakeStore, handle } = makeFakeStore([]);

    const embed = vi.fn(async (req: { inputs: string[] }) => ({
      embeddings: req.inputs.map((_, i) => [i + 1, 0, 0]),
      usage: { tokens: req.inputs.length * 2 },
    }));
    const resolver: EmbeddingProviderResolver = {
      resolve: async () => ({
        provider: { embed },
        config: { providerId: 'voyage', modelId: 'voyage-2' },
      }),
    };

    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => fakeStore,
      listWorkspaces: () => [ws],
      getWorkspace: (id) => (id === ws.id ? ws : null),
      watcherFactory: () => {
        const w = new CapturingWatcher();
        captured.push(w);
        return w;
      },
      embeddingResolver: resolver,
      readFile: async () => 'export const a = 1;\nexport const b = 2;\n',
      chunkFn: (text: string) => [
        { content: text, startLine: 1, endLine: text.split('\n').length },
      ],
    });
    await indexer.start();

    captured[0]?.trigger({ added: ['src/a.ts'], changed: [], removed: [] });
    await indexer.waitForReindex();

    expect(embed).toHaveBeenCalledTimes(1);
    expect(handle.upsert).toHaveBeenCalled();
    const [argPath, argChunks] = handle.upsert.mock.calls[0] ?? [];
    expect(argPath).toBe('src/a.ts');
    expect(Array.isArray(argChunks)).toBe(true);
    expect((argChunks as Array<{ embedding: number[] }>).length).toBe(1);

    await indexer.stop();
  });

  it('removed paths trigger empty upsert without invoking embedder', async () => {
    const ws = makeWorkspace('ws1', baseDir, true);
    const captured: CapturingWatcher[] = [];
    const { store: fakeStore, handle } = makeFakeStore([]);
    const embed = vi.fn();
    const resolver: EmbeddingProviderResolver = {
      resolve: async () => ({
        provider: { embed: embed as never },
        config: { providerId: 'voyage', modelId: 'voyage-2' },
      }),
    };
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => fakeStore,
      listWorkspaces: () => [ws],
      getWorkspace: (id) => (id === ws.id ? ws : null),
      watcherFactory: () => {
        const w = new CapturingWatcher();
        captured.push(w);
        return w;
      },
      embeddingResolver: resolver,
    });
    await indexer.start();
    captured[0]?.trigger({ added: [], changed: [], removed: ['gone.ts'] });
    await indexer.waitForReindex();
    expect(handle.upsert).toHaveBeenCalledWith('gone.ts', []);
    expect(embed).not.toHaveBeenCalled();
    await indexer.stop();
  });

  it('skips reindex when no embedding resolver is configured', async () => {
    const ws = makeWorkspace('ws1', baseDir, true);
    const captured: CapturingWatcher[] = [];
    const { store: fakeStore, handle } = makeFakeStore([]);
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => fakeStore,
      listWorkspaces: () => [ws],
      getWorkspace: (id) => (id === ws.id ? ws : null),
      watcherFactory: () => {
        const w = new CapturingWatcher();
        captured.push(w);
        return w;
      },
      readFile: async () => 'hi',
    });
    await indexer.start();
    captured[0]?.trigger({ added: ['x.ts'], changed: [], removed: [] });
    await indexer.waitForReindex();
    expect(handle.upsert).not.toHaveBeenCalled();
    await indexer.stop();
  });

  it('addWorkspace / removeWorkspace mutate the active set after start', async () => {
    const ws1 = makeWorkspace('ws1', path.join(baseDir, 's1'), true);
    const ws2 = makeWorkspace('ws2', path.join(baseDir, 's2'));
    const all = [ws1, ws2];
    const indexer = new MultiWorkspaceIndexer({
      baseDir,
      storeFactory: () => makeFakeStore([]).store,
      listWorkspaces: () => [ws1],
      getWorkspace: (id) => all.find((w) => w.id === id) ?? null,
      watcherFactory: () => new StubWatcher(),
    });
    await indexer.start();
    expect(indexer.listActiveWorkspaceIds()).toEqual(['ws1']);

    await indexer.addWorkspace('ws2');
    expect(indexer.listActiveWorkspaceIds().sort()).toEqual(['ws1', 'ws2']);

    await indexer.removeWorkspace('ws1');
    expect(indexer.listActiveWorkspaceIds()).toEqual(['ws2']);

    await indexer.stop();
  });
});
