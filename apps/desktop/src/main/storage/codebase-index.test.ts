import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearIndex,
  getIndexedFileMeta,
  removeIndexedFile,
  searchKeyword,
  upsertIndexedFile,
} from './codebase-index';
import { applyMigrations, setDbForTesting } from './db';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('migration v5', () => {
  it('creates the indexed_files FTS5 table and meta table', () => {
    const objects = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE name IN ('indexed_files', 'indexed_files_meta')`,
      )
      .all() as { name: string }[];
    const names = objects.map((o) => o.name).sort();
    expect(names).toContain('indexed_files');
    expect(names).toContain('indexed_files_meta');
  });

  it('records migration version 5 in schema_migrations', () => {
    const rows = db.prepare(`SELECT version FROM schema_migrations ORDER BY version ASC`).all() as {
      version: number;
    }[];
    expect(rows.map((r) => r.version)).toContain(5);
  });
});

describe('upsertIndexedFile', () => {
  it('inserts a row that is searchable and recorded in meta', () => {
    upsertIndexedFile('src/foo.ts', 'export function greet() { return "hello world"; }', 1000, 50);
    const hits = searchKeyword('hello');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('src/foo.ts');

    const meta = getIndexedFileMeta('src/foo.ts');
    expect(meta).not.toBeNull();
    expect(meta?.mtime).toBe(1000);
    expect(meta?.size).toBe(50);
    expect(meta?.indexedAt).toBeTruthy();
  });

  it('replaces an existing entry on re-upsert (no duplicates)', () => {
    upsertIndexedFile('src/foo.ts', 'first version contains apple', 100, 28);
    upsertIndexedFile('src/foo.ts', 'second version contains banana', 200, 30);

    const appleHits = searchKeyword('apple');
    expect(appleHits).toHaveLength(0);

    const bananaHits = searchKeyword('banana');
    expect(bananaHits).toHaveLength(1);
    expect(bananaHits[0]?.path).toBe('src/foo.ts');

    const meta = getIndexedFileMeta('src/foo.ts');
    expect(meta?.mtime).toBe(200);
    expect(meta?.size).toBe(30);

    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM indexed_files WHERE path = ?').get('src/foo.ts') as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });
});

describe('removeIndexedFile', () => {
  it('removes both content row and meta row', () => {
    upsertIndexedFile('src/foo.ts', 'alpha beta gamma', 100, 16);
    upsertIndexedFile('src/bar.ts', 'alpha delta', 100, 11);

    removeIndexedFile('src/foo.ts');

    const hits = searchKeyword('alpha');
    expect(hits.map((h) => h.path)).toEqual(['src/bar.ts']);
    expect(getIndexedFileMeta('src/foo.ts')).toBeNull();
    expect(getIndexedFileMeta('src/bar.ts')).not.toBeNull();
  });

  it('is a no-op for unknown paths', () => {
    expect(() => removeIndexedFile('nope.ts')).not.toThrow();
  });
});

describe('searchKeyword', () => {
  function seed(): void {
    upsertIndexedFile(
      'src/auth.ts',
      'function login(username, password) { validate(username); return true; }',
      1,
      80,
    );
    upsertIndexedFile(
      'src/users.ts',
      'export interface User { username: string; email: string; }',
      2,
      60,
    );
    upsertIndexedFile(
      'src/utils.ts',
      'export function formatDate(d) { return d.toISOString(); }',
      3,
      55,
    );
  }

  it('returns ranked hits ordered by bm25 score (lower is better)', () => {
    seed();
    const hits = searchKeyword('username');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const paths = hits.map((h) => h.path);
    expect(paths).toContain('src/auth.ts');
    expect(paths).toContain('src/users.ts');
    for (let i = 1; i < hits.length; i++) {
      const prev = hits[i - 1];
      const cur = hits[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      expect(prev!.score).toBeLessThanOrEqual(cur!.score);
    }
  });

  it('includes a snippet with highlight markers around matches', () => {
    seed();
    const hits = searchKeyword('login');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('src/auth.ts');
    expect(hits[0]?.snippet).toContain('[');
    expect(hits[0]?.snippet).toContain(']');
    expect(hits[0]?.snippet.toLowerCase()).toContain('login');
  });

  it('returns empty array for an empty or whitespace-only query', () => {
    seed();
    expect(searchKeyword('')).toEqual([]);
    expect(searchKeyword('   ')).toEqual([]);
  });

  it('returns empty array when nothing matches', () => {
    seed();
    expect(searchKeyword('zzz_nonexistent_token')).toEqual([]);
  });

  it('respects the limit argument', () => {
    for (let i = 0; i < 10; i++) {
      upsertIndexedFile(`src/file-${i}.ts`, 'shared_token in every file', i, 28);
    }
    const hits = searchKeyword('shared_token', 3);
    expect(hits).toHaveLength(3);
  });

  it('handles multi-token queries (AND semantics)', () => {
    seed();
    const both = searchKeyword('username password');
    expect(both.map((h) => h.path)).toEqual(['src/auth.ts']);

    const onlyUsers = searchKeyword('username email');
    expect(onlyUsers.map((h) => h.path)).toEqual(['src/users.ts']);
  });

  it('sanitises FTS5 special characters in queries', () => {
    seed();
    expect(() => searchKeyword('"unterminated quote')).not.toThrow();
    expect(() => searchKeyword('(unbalanced')).not.toThrow();
    expect(() => searchKeyword('foo:bar*')).not.toThrow();
  });
});

describe('clearIndex', () => {
  it('removes every indexed row and reports the deleted count', () => {
    upsertIndexedFile('a.ts', 'one', 1, 3);
    upsertIndexedFile('b.ts', 'two', 2, 3);
    upsertIndexedFile('c.ts', 'three', 3, 5);

    const { deletedCount } = clearIndex();
    expect(deletedCount).toBe(3);

    expect(searchKeyword('one')).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM indexed_files').get() as { n: number }).n).toBe(
      0,
    );
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM indexed_files_meta').get() as { n: number }).n,
    ).toBe(0);
  });

  it('returns 0 when the index is already empty', () => {
    expect(clearIndex().deletedCount).toBe(0);
  });
});
