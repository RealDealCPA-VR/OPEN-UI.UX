import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MultiWorkspaceIndexer } from './multi-workspace-indexer';
import type { LanceVectorStore, VectorSearchHit } from './vector-store';
import { WorkspaceWatcher } from './watcher';
import type { WorkspaceEntry } from '../../shared/workspaces';

interface FakeStoreHandle {
  open: Mock;
  close: Mock;
  searchByVector: Mock;
}

function makeFakeStore(hits: VectorSearchHit[]): {
  store: LanceVectorStore;
  handle: FakeStoreHandle;
} {
  const handle: FakeStoreHandle = {
    open: vi.fn(),
    close: vi.fn(),
    searchByVector: vi.fn(() => hits),
  };
  const store = handle as unknown as LanceVectorStore;
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
