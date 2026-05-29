import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { chunkBySize, type Chunk } from '@opencodex/rag-chunker';
import type { LLMProvider } from '@opencodex/core';
import { SqliteVectorStore, type VectorSearchHit } from './vector-store';
import { WorkspaceWatcher, type WatcherBatch } from './watcher';
import { logger } from '../logger';
import { reciprocalRankFusion } from '@opencodex/tools';
import {
  listWorkspaces as listWorkspacesFromStore,
  getWorkspaceById,
} from '../workspace/workspaces-store';
import type { WorkspaceEntry } from '../../shared/workspaces';
import type { MultiWorkspaceSearchHit } from '../../shared/workspaces';

export interface EmbeddingPipelineConfig {
  providerId: string;
  modelId: string;
}

export interface EmbeddingProviderResolver {
  resolve(): Promise<{
    provider: Pick<LLMProvider, 'embed'>;
    config: EmbeddingPipelineConfig;
  } | null>;
}

export type ChunkFn = (text: string, path: string) => Promise<Chunk[]> | Chunk[];

export type ReadFileFn = (absPath: string) => Promise<string | null>;

const MAX_INDEXED_BYTES = 256 * 1024;
const EMBED_BATCH_SIZE = 32;

export interface MultiWorkspaceIndexerOptions {
  /** Root directory under which each workspace gets its own vector DB folder. */
  baseDir: string;
  /** Factory used so tests can mock SqliteVectorStore. */
  storeFactory?: () => SqliteVectorStore;
  /** Lookup that returns currently configured workspaces. Defaults to DB-backed list. */
  listWorkspaces?: () => WorkspaceEntry[];
  /** Lookup for a single workspace by id. Defaults to DB-backed lookup. */
  getWorkspace?: (id: string) => WorkspaceEntry | null;
  /** Watcher factory so tests can avoid actual chokidar usage. */
  watcherFactory?: () => WorkspaceWatcher;
  /** Resolves the active embedding provider for the indexer. Null when none configured. */
  embeddingResolver?: EmbeddingProviderResolver;
  /** Chunker used to split file contents into vector rows. */
  chunkFn?: ChunkFn;
  /** Reads a file from disk; null result means "skip". Test seam. */
  readFile?: ReadFileFn;
}

interface IndexerEntry {
  workspace: WorkspaceEntry;
  store: SqliteVectorStore;
  watcher: WorkspaceWatcher | null;
}

/**
 * Manages a per-workspace vector index. Each workspace gets its own SqliteVectorStore
 * under `<baseDir>/<workspaceId>/`. Provides cross-workspace search by querying each
 * configured workspace's store and fusing the per-workspace rankings via RRF.
 *
 * Watcher batches drive incremental reindex: deleted paths are removed, added/changed
 * paths are read, chunked via the configured chunker, embedded via the resolved
 * embedding provider, and upserted.
 */
export class MultiWorkspaceIndexer {
  private readonly baseDir: string;
  private readonly storeFactory: () => SqliteVectorStore;
  private readonly listWorkspaces: () => WorkspaceEntry[];
  private readonly getWorkspace: (id: string) => WorkspaceEntry | null;
  private readonly watcherFactory: () => WorkspaceWatcher;
  private readonly embeddingResolver: EmbeddingProviderResolver | null;
  private readonly chunkFn: ChunkFn;
  private readonly readFile: ReadFileFn;
  private readonly entries = new Map<string, IndexerEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private started = false;

  constructor(options: MultiWorkspaceIndexerOptions) {
    this.baseDir = options.baseDir;
    this.storeFactory = options.storeFactory ?? ((): SqliteVectorStore => new SqliteVectorStore());
    this.listWorkspaces = options.listWorkspaces ?? listWorkspacesFromStore;
    this.getWorkspace = options.getWorkspace ?? getWorkspaceById;
    this.watcherFactory =
      options.watcherFactory ?? ((): WorkspaceWatcher => new WorkspaceWatcher());
    this.embeddingResolver = options.embeddingResolver ?? null;
    this.chunkFn = options.chunkFn ?? ((text: string): Chunk[] => chunkBySize(text, 1500, 100));
    this.readFile = options.readFile ?? defaultReadFile;
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

  getStore(workspaceId: string): SqliteVectorStore | null {
    return this.entries.get(workspaceId)?.store ?? null;
  }

  listActiveWorkspaceIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Resolves once all queued reindex operations finish. Test helper. */
  async waitForReindex(): Promise<void> {
    await Promise.all(this.inFlight.values());
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
    const queued = this.inFlight.get(workspaceId) ?? Promise.resolve();
    const next = queued
      .then(() => this.processBatch(workspaceId, batch))
      .catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), workspaceId },
          'multi-workspace reindex batch failed',
        );
      });
    this.inFlight.set(workspaceId, next);
  }

  private async processBatch(workspaceId: string, batch: WatcherBatch): Promise<void> {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;

    for (const rel of batch.removed) {
      try {
        entry.store.upsert(rel, []);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), workspaceId, path: rel },
          'failed to remove vector rows',
        );
      }
    }

    const toIndex = [...batch.added, ...batch.changed];
    if (toIndex.length === 0) return;

    if (!this.embeddingResolver) return;
    const resolved = await this.embeddingResolver.resolve();
    if (!resolved) {
      logger.debug({ workspaceId }, 'no embedding provider resolved; skipping reindex');
      return;
    }

    for (const rel of toIndex) {
      const abs = join(entry.workspace.path, rel);
      let content: string | null;
      try {
        content = await this.readFile(abs);
      } catch (err) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err), workspaceId, path: rel },
          'reindex: read failed; skipping',
        );
        continue;
      }
      if (content === null) continue;

      let chunks: Chunk[];
      try {
        chunks = await this.chunkFn(content, rel);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), workspaceId, path: rel },
          'reindex: chunker failed',
        );
        continue;
      }
      if (chunks.length === 0) {
        try {
          entry.store.upsert(rel, []);
        } catch {
          // best-effort
        }
        continue;
      }

      try {
        const embeddings = await embedChunksInBatches(
          resolved.provider,
          resolved.config.modelId,
          chunks.map((c) => c.content),
        );
        const rows = chunks.map((chunk, i) => ({
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embedding: embeddings[i] ?? [],
        }));
        entry.store.upsert(rel, rows);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), workspaceId, path: rel },
          'reindex: embed/upsert failed',
        );
      }
    }
  }
}

async function defaultReadFile(absPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_INDEXED_BYTES) return null;
    const buf = await fs.readFile(absPath);
    if (looksBinary(buf)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 4096));
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true;
  }
  return false;
}

async function embedChunksInBatches(
  provider: Pick<LLMProvider, 'embed'>,
  modelId: string,
  inputs: readonly string[],
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const slice = inputs.slice(i, i + EMBED_BATCH_SIZE);
    const result = await provider.embed({ model: modelId, inputs: slice });
    for (const e of result.embeddings) out.push(e);
  }
  return out;
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
