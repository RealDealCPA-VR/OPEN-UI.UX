import type Database from 'better-sqlite3';
import { getDb } from './db';

export interface IndexedFileMeta {
  path: string;
  mtime: number;
  size: number;
  indexedAt: string;
}

export interface KeywordSearchHit {
  path: string;
  score: number;
  snippet: string;
}

export function upsertIndexedFile(
  path: string,
  content: string,
  mtime: number,
  size: number,
  db: Database.Database = getDb(),
): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM indexed_files WHERE path = ?').run(path);
    db.prepare('INSERT INTO indexed_files (path, content) VALUES (?, ?)').run(path, content);
    db.prepare(
      `INSERT INTO indexed_files_meta (path, mtime, size, indexed_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(path) DO UPDATE SET
         mtime = excluded.mtime,
         size = excluded.size,
         indexed_at = CURRENT_TIMESTAMP`,
    ).run(path, mtime, size);
  });
  tx();
}

export function removeIndexedFile(path: string, db: Database.Database = getDb()): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM indexed_files WHERE path = ?').run(path);
    db.prepare('DELETE FROM indexed_files_meta WHERE path = ?').run(path);
  });
  tx();
}

export function getIndexedFileMeta(
  path: string,
  db: Database.Database = getDb(),
): IndexedFileMeta | null {
  const row = db
    .prepare('SELECT path, mtime, size, indexed_at FROM indexed_files_meta WHERE path = ?')
    .get(path) as { path: string; mtime: number; size: number; indexed_at: string } | undefined;
  if (!row) return null;
  return { path: row.path, mtime: row.mtime, size: row.size, indexedAt: row.indexed_at };
}

export function searchKeyword(
  query: string,
  limit = 50,
  db: Database.Database = getDb(),
): KeywordSearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const matchQuery = toFts5MatchQuery(trimmed);
  if (matchQuery.length === 0) return [];

  const clampedLimit = Math.max(1, Math.min(Math.floor(limit), 500));

  const rows = db
    .prepare(
      `SELECT
         path,
         bm25(indexed_files) AS score,
         snippet(indexed_files, 1, '[', ']', '...', 8) AS snippet
       FROM indexed_files
       WHERE indexed_files MATCH ?
       ORDER BY score ASC
       LIMIT ?`,
    )
    .all(matchQuery, clampedLimit) as Array<{
    path: string;
    score: number;
    snippet: string;
  }>;

  return rows.map((r) => ({ path: r.path, score: r.score, snippet: r.snippet }));
}

export function clearIndex(db: Database.Database = getDb()): { deletedCount: number } {
  const tx = db.transaction(() => {
    const result = db.prepare('DELETE FROM indexed_files_meta').run();
    db.prepare('DELETE FROM indexed_files').run();
    return result.changes;
  });
  return { deletedCount: tx() };
}

function toFts5MatchQuery(input: string): string {
  const tokens = input
    .split(/\s+/u)
    .map((t) => t.replace(/["()*:^]/gu, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' ');
}
