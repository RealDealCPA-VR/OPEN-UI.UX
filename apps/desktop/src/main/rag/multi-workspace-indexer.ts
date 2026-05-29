import { join } from 'node:path';
import { LanceVectorStore, type VectorSearchHit } from './vector-store';
import { WorkspaceWatcher, type WatcherBatch } from './watcher';
import { logger } from '../logger';
import { reciprocalRankFusion } from '@opencodex/tools';
import {
  listWorkspaces as listWorkspacesFromStore,
  getWorkspaceById,
} from '../workspace/workspaces-store';
import type { WorkspaceEntry } from '../../shared/workspaces';
import type { MultiWorkspaceSearchHit } from '../../shared/workspaces';

export interface MultiWorkspaceIndexerOptions {
  /** Root directory under which each workspace gets its own vector DB folder. */
  baseDir: string;
  /** Factory used so tests can mock LanceVectorStore. */
  storeFactory?: () => LanceVectorStore;
  /** Lookup that returns currently configured workspaces. Defaults to DB-backed list. */
  listWorkspaces?: () => WorkspaceEntry[];
  /** Lookup for a single workspace by id. Defaults to DB-backed lookup. */
  getWorkspace?: (id: string) => WorkspaceEntry | null;
  /** Watcher factory so tests can avoid actual chokidar usage. */
  watcherFactory?: () => WorkspaceWatcher;
}

interface IndexerEntry {
  workspace: WorkspaceEntry;
  store: LanceVectorStore;
  watcher: WorkspaceWatcher | null;
}

/**
 * Manages a per-workspace vector index. Each workspace gets its own LanceVectorStore
 * under `<baseDir>/<workspaceId>/`. Provides cross-workspace search by querying each
 * configured workspace's store and fusing the per-workspace rankings via RRF.
 *
 * Today the watcher only logs batches; actual reindex pipeline (chunker + embedder)
 * is wired in by the consolidator alongside the existing single-workspace pipeline.
 */
export class MultiWorkspaceIndexer {
  private readonly baseDir: string;
  private readonly storeFactory: () => LanceVectorStore;
  private readonly listWorkspaces: () => WorkspaceEntry[];
  private readonly getWorkspace: (id: string) => WorkspaceEntry | null;
  private readonly watcherFactory: () => WorkspaceWatcher;
  private readonly entries = new Map<string, IndexerEntry>();
  private started = false;

  constructor(options: MultiWorkspaceIndexerOptions) {
    this.baseDir = options.baseDir;
    this.storeFactory = options.storeFactory ?? ((): LanceVectorStore => new LanceVectorStore());
    this.listWorkspaces = options.listWorkspaces ?? listWorkspacesFromStore;
    this.getWorkspace = options.getWorkspace ?? getWorkspaceById;
    this.watcherFactory =
      options.watcherFactory ?? ((): WorkspaceWatcher => new WorkspaceWatcher());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const workspaces = this.listWorkspaces();
    for (const ws of workspaces) {
      if (!ws.ragEnabled) continue;
      await this.ensureIndex(ws);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const entry of this.entries.values()) {
      if (entry.watcher) {
        await entry.watcher.stop();
      }
      entry.store.close();
    }
    this.entries.clear();
  }

  async addWorkspace(workspaceId: string): Promise<void> {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) return;
    if (!ws.ragEnabled) return;
    await this.ensureIndex(ws);
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    if (entry.watcher) await entry.watcher.stop();
    entry.store.close();
    this.entries.delete(workspaceId);
  }

  async syncFromDb(): Promise<void> {
    const desired = new Map(
      this.listWorkspaces()
        .filter((w) => w.ragEnabled)
        .map((w) => [w.id, w] as const),
    );
    for (const id of Array.from(this.entries.keys())) {
      if (!desired.has(id)) {
        await this.removeWorkspace(id);
      }
    }
    for (const ws of desired.values()) {
      if (!this.entries.has(ws.id)) {
        await this.ensureIndex(ws);
      }
    }
  }

  getStore(workspaceId: string): LanceVectorStore | null {
    return this.entries.get(workspaceId)?.store ?? null;
  }

  listActiveWorkspaceIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Run an embedding query across the requested workspaces and fuse the results
   * via reciprocal rank fusion. Each hit is tagged with its source workspaceId.
   *
   * If `workspaceIds` is empty, returns no hits — callers should default to the
   * primary workspace at the application boundary.
   */
  searchAcrossWorkspaces(
    embedding: readonly number[],
    workspaceIds: readonly string[],
    limit = 50,
  ): MultiWorkspaceSearchHit[] {
    if (workspaceIds.length === 0) return [];
    const perWorkspace: MultiWorkspaceSearchHit[][] = [];
    for (const id of workspaceIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      let raw: VectorSearchHit[];
      try {
        raw = entry.store.searchByVector(embedding, limit);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), workspaceId: id },
          'multi-workspace search failed for workspace; skipping',
        );
        continue;
      }
      perWorkspace.push(
        raw.map((hit) => ({
          workspaceId: id,
          path: hit.path,
          content: hit.content,
          score: hit.score,
          startLine: hit.startLine,
          endLine: hit.endLine,
        })),
      );
    }
    const fused = reciprocalRankFusion(
      perWorkspace,
      (hit) => `${hit.workspaceId}:${hit.path}:${hit.startLine}-${hit.endLine}`,
    );
    return fused.slice(0, limit);
  }

  private async ensureIndex(workspace: WorkspaceEntry): Promise<void> {
    if (this.entries.has(workspace.id)) return;
    const dir = join(this.baseDir, workspace.id);
    const store = this.storeFactory();
    try {
      store.open(dir);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), workspaceId: workspace.id, dir },
        'failed to open vector store for workspace; skipping',
      );
      return;
    }
    let watcher: WorkspaceWatcher | null = null;
    try {
      watcher = this.watcherFactory();
      await watcher.start(workspace.path, (batch: WatcherBatch) =>
        this.onBatch(workspace.id, batch),
      );
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          workspaceId: workspace.id,
        },
        'multi-workspace watcher start failed; index will be static',
      );
      watcher = null;
    }
    this.entries.set(workspace.id, { workspace, store, watcher });
  }

  private onBatch(workspaceId: string, batch: WatcherBatch): void {
    logger.debug(
      {
        workspaceId,
        added: batch.added.length,
        changed: batch.changed.length,
        removed: batch.removed.length,
      },
      'multi-workspace watcher batch',
    );
  }
}

let activeIndexer: MultiWorkspaceIndexer | null = null;

export function setActiveMultiWorkspaceIndexer(
  indexer: MultiWorkspaceIndexer | null,
): MultiWorkspaceIndexer | null {
  activeIndexer = indexer;
  return indexer;
}

export function getActiveMultiWorkspaceIndexer(): MultiWorkspaceIndexer | null {
  return activeIndexer;
}
