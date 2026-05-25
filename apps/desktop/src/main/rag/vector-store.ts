import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface VectorChunk {
  content: string;
  startLine: number;
  endLine: number;
  embedding: number[];
}

export interface VectorSearchHit {
  path: string;
  content: string;
  score: number;
  startLine: number;
  endLine: number;
}

interface StoredRow {
  path: string;
  content: string;
  start_line: number;
  end_line: number;
  embedding: Buffer;
}

/**
 * Vector store for RAG retrieval.
 *
 * NOTE: This is a SQLite-backed shim because `@lancedb/lancedb` ships a native
 * binary that did not install in the current toolchain. The public interface
 * (`open`, `upsert`, `searchByVector`, `clear`) mirrors what a thin LanceDB
 * adapter would expose, so swapping in real LanceDB later is a one-class
 * change with no callers needing to update.
 *
 * Embeddings are persisted as Float32Array buffers and cosine similarity is
 * computed in-process at query time. Fine for small to mid-size workspaces;
 * swap to LanceDB before this matters at scale.
 */
export class LanceVectorStore {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;

  /**
   * Opens (or creates) the vector store at `<dbPath>/lance.db`. Pass
   * `:memory:` to use an in-memory database (intended for tests).
   */
  open(dbPath: string): void {
    if (this.db) {
      throw new Error('LanceVectorStore is already open');
    }
    let target: string;
    if (dbPath === ':memory:') {
      target = ':memory:';
    } else {
      mkdirSync(dbPath, { recursive: true });
      target = join(dbPath, 'lance.db');
    }
    const instance = new Database(target);
    if (target !== ':memory:') {
      instance.pragma('journal_mode = WAL');
    }
    instance.pragma('foreign_keys = ON');
    instance.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        path        TEXT NOT NULL,
        content     TEXT NOT NULL,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        embedding   BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_path ON vectors(path);
    `);
    this.db = instance;
    this.dbPath = target;
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
    this.dbPath = null;
  }

  /** Returns the resolved DB file path or `:memory:`. */
  get path(): string | null {
    return this.dbPath;
  }

  /**
   * Replaces all existing chunks for `path` with the provided set.
   * Empty `chunks` deletes any existing rows for that path.
   */
  upsert(path: string, chunks: readonly VectorChunk[]): void {
    const db = this.requireDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM vectors WHERE path = ?').run(path);
      if (chunks.length === 0) return;
      const insert = db.prepare(
        `INSERT INTO vectors (path, content, start_line, end_line, embedding)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const chunk of chunks) {
        insert.run(
          path,
          chunk.content,
          chunk.startLine,
          chunk.endLine,
          encodeEmbedding(chunk.embedding),
        );
      }
    });
    tx();
  }

  /**
   * Returns the top-`limit` chunks by cosine similarity to `embedding`,
   * sorted descending (highest score first). Score is in `[-1, 1]`.
   */
  searchByVector(embedding: readonly number[], limit = 50): VectorSearchHit[] {
    const db = this.requireDb();
    if (embedding.length === 0) return [];
    const clamped = Math.max(1, Math.min(Math.floor(limit), 1000));

    const queryNorm = vectorNorm(embedding);
    if (queryNorm === 0) return [];

    const rows = db
      .prepare(`SELECT path, content, start_line, end_line, embedding FROM vectors`)
      .all() as StoredRow[];

    const scored: VectorSearchHit[] = [];
    for (const row of rows) {
      const vec = decodeEmbedding(row.embedding);
      if (vec.length !== embedding.length) continue;
      const score = cosineSimilarity(embedding, vec, queryNorm);
      scored.push({
        path: row.path,
        content: row.content,
        score,
        startLine: row.start_line,
        endLine: row.end_line,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, clamped);
  }

  /** Removes every row from the store. */
  clear(): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM vectors').run();
  }

  /** Total chunks currently stored. Exposed for tests + status panels. */
  count(): number {
    const db = this.requireDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM vectors').get() as { n: number };
    return row.n;
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('LanceVectorStore is not open — call open() first');
    return this.db;
  }
}

function encodeEmbedding(values: readonly number[]): Buffer {
  const arr = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    arr[i] = values[i] ?? 0;
  }
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function decodeEmbedding(buf: Buffer): Float32Array {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, buf.byteLength / 4);
}

function vectorNorm(values: readonly number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: readonly number[], b: Float32Array, aNorm: number): number {
  let dot = 0;
  let bSqSum = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    bSqSum += bv * bv;
  }
  const bNorm = Math.sqrt(bSqSum);
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (aNorm * bNorm);
}
