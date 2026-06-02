import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanceVectorStore, SqliteVectorStore, type VectorChunk } from './vector-store';

function makeChunk(
  content: string,
  startLine: number,
  endLine: number,
  embedding: number[],
): VectorChunk {
  return { content, startLine, endLine, embedding };
}

interface Tmp {
  root: string;
  cleanup(): Promise<void>;
}

async function createTmp(): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-vector-test-'));
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe('LanceVectorStore', () => {
  let store: LanceVectorStore;

  beforeEach(() => {
    store = new LanceVectorStore();
    store.open(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('open', () => {
    it('throws when called twice on the same instance', () => {
      expect(() => store.open(':memory:')).toThrow(/already open/);
    });

    it('persists data to a file under the provided directory', async () => {
      store.close();
      const tmp = await createTmp();
      try {
        const persistent = new LanceVectorStore();
        persistent.open(tmp.root);
        persistent.upsert('a.ts', [makeChunk('hello', 1, 2, [1, 0, 0])]);
        expect(persistent.count()).toBe(1);
        persistent.close();

        const dbFile = path.join(tmp.root, 'vectors.db');
        const stat = await fs.stat(dbFile);
        expect(stat.isFile()).toBe(true);

        const reopened = new LanceVectorStore();
        reopened.open(tmp.root);
        try {
          expect(reopened.count()).toBe(1);
          const hits = reopened.searchByVector([1, 0, 0], 5);
          expect(hits).toHaveLength(1);
          expect(hits[0]?.path).toBe('a.ts');
          expect(hits[0]?.content).toBe('hello');
        } finally {
          reopened.close();
        }
      } finally {
        await tmp.cleanup();
        store = new LanceVectorStore();
        store.open(':memory:');
      }
    });
  });

  describe('upsert', () => {
    it('inserts multiple chunks for a single path', () => {
      store.upsert('src/foo.ts', [
        makeChunk('chunk one', 1, 5, [1, 0, 0]),
        makeChunk('chunk two', 6, 10, [0, 1, 0]),
      ]);
      expect(store.count()).toBe(2);
    });

    it('replaces all chunks for a path when re-upserted', () => {
      store.upsert('src/foo.ts', [
        makeChunk('original', 1, 5, [1, 0, 0]),
        makeChunk('original-2', 6, 10, [0, 1, 0]),
      ]);
      expect(store.count()).toBe(2);

      store.upsert('src/foo.ts', [makeChunk('replacement', 1, 3, [0, 0, 1])]);
      expect(store.count()).toBe(1);

      const hits = store.searchByVector([0, 0, 1], 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.content).toBe('replacement');
    });

    it('deleting via empty upsert removes existing rows for that path', () => {
      store.upsert('src/foo.ts', [makeChunk('x', 1, 1, [1, 0, 0])]);
      store.upsert('src/bar.ts', [makeChunk('y', 1, 1, [0, 1, 0])]);
      expect(store.count()).toBe(2);

      store.upsert('src/foo.ts', []);
      expect(store.count()).toBe(1);

      const hits = store.searchByVector([1, 0, 0], 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.path).toBe('src/bar.ts');
    });
  });

  describe('searchByVector', () => {
    function seed(): void {
      store.upsert('a.ts', [makeChunk('about login auth', 1, 5, [1, 0, 0])]);
      store.upsert('b.ts', [makeChunk('renders react component', 1, 8, [0, 1, 0])]);
      store.upsert('c.ts', [makeChunk('database migration sql', 1, 6, [0, 0, 1])]);
    }

    it('returns hits ranked by descending cosine similarity', () => {
      seed();
      const hits = store.searchByVector([1, 0, 0], 10);
      expect(hits).toHaveLength(3);
      expect(hits[0]?.path).toBe('a.ts');
      for (let i = 1; i < hits.length; i++) {
        const prev = hits[i - 1];
        const cur = hits[i];
        expect(prev!.score).toBeGreaterThanOrEqual(cur!.score);
      }
    });

    it('produces a score near 1.0 for an identical embedding', () => {
      store.upsert('match.ts', [makeChunk('m', 1, 1, [0.5, 0.5, 0.5])]);
      const hits = store.searchByVector([0.5, 0.5, 0.5], 1);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.score).toBeCloseTo(1, 5);
    });

    it('respects the limit argument', () => {
      for (let i = 0; i < 5; i++) {
        store.upsert(`file-${i}.ts`, [makeChunk('x', 1, 1, [1, 0, 0])]);
      }
      const hits = store.searchByVector([1, 0, 0], 3);
      expect(hits).toHaveLength(3);
    });

    it('returns an empty array for an empty embedding', () => {
      store.upsert('a.ts', [makeChunk('x', 1, 1, [1, 0, 0])]);
      expect(store.searchByVector([], 10)).toEqual([]);
    });

    it('returns an empty array for a zero-norm embedding', () => {
      store.upsert('a.ts', [makeChunk('x', 1, 1, [1, 0, 0])]);
      expect(store.searchByVector([0, 0, 0], 10)).toEqual([]);
    });

    it('skips chunks whose embedding dimension differs from the query', () => {
      store.upsert('a.ts', [makeChunk('three-dim', 1, 1, [1, 0, 0])]);
      store.upsert('b.ts', [makeChunk('four-dim', 1, 1, [1, 0, 0, 0])]);
      const hits = store.searchByVector([1, 0, 0], 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.path).toBe('a.ts');
    });

    it('includes start/end line metadata in hits', () => {
      store.upsert('a.ts', [makeChunk('block', 42, 99, [1, 0, 0])]);
      const hits = store.searchByVector([1, 0, 0], 1);
      expect(hits[0]?.startLine).toBe(42);
      expect(hits[0]?.endLine).toBe(99);
    });

    it('returns empty when the store is empty', () => {
      expect(store.searchByVector([1, 0, 0], 10)).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes every row', () => {
      store.upsert('a.ts', [makeChunk('x', 1, 1, [1, 0, 0])]);
      store.upsert('b.ts', [makeChunk('y', 1, 1, [0, 1, 0])]);
      expect(store.count()).toBe(2);
      store.clear();
      expect(store.count()).toBe(0);
      expect(store.searchByVector([1, 0, 0], 10)).toEqual([]);
    });

    it('is a no-op on an empty store', () => {
      expect(() => store.clear()).not.toThrow();
      expect(store.count()).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('throws when used before open', () => {
      const fresh = new LanceVectorStore();
      expect(() => fresh.upsert('a.ts', [])).toThrow(/not open/);
      expect(() => fresh.searchByVector([1, 0, 0])).toThrow(/not open/);
      expect(() => fresh.clear()).toThrow(/not open/);
      expect(() => fresh.count()).toThrow(/not open/);
    });

    it('close is idempotent', () => {
      const fresh = new LanceVectorStore();
      fresh.open(':memory:');
      fresh.close();
      expect(() => fresh.close()).not.toThrow();
    });

    it('reports the in-memory path correctly', () => {
      expect(store.path).toBe(':memory:');
    });
  });

  describe('class aliases', () => {
    it('LanceVectorStore is an alias for SqliteVectorStore', () => {
      expect(LanceVectorStore).toBe(SqliteVectorStore);
    });
  });

  describe('magnitude bucket prefilter', () => {
    it('still returns the highest-cosine match even when many vectors live in distant buckets', () => {
      // Exact directional match for query [1,0,0], but its large magnitude (norm 10)
      // places it OUTSIDE the query's magnitude bucket window.
      store.upsert('exact.ts', [makeChunk('hit', 1, 1, [10, 0, 0])]);
      // Seed MORE than candidateLimit (max(limit*8, 256)) orthogonal distractors whose
      // norm (1.0) sits squarely inside the query's bucket window. With > candidateLimit
      // in-bucket rows the prefilter fills its LIMIT entirely, so the all-rows fallback
      // (rows.length < clamped) never engages and the out-of-bucket exact match is dropped.
      // These distractors are orthogonal to the query (cosine 0), so a correct ranking
      // must still surface exact.ts first.
      for (let i = 0; i < 300; i++) {
        store.upsert(`noise-${i}.ts`, [makeChunk('miss', 1, 1, [0, 1, 0])]);
      }
      const hits = store.searchByVector([1, 0, 0], 5);
      expect(hits[0]?.path).toBe('exact.ts');
    });
  });
});
