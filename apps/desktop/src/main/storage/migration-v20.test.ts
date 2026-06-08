import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './db';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => {
  db.close();
});

describe('migration v20 — checkpoints', () => {
  it('applies on a v19 DB adding both checkpoint tables + FK cascade', () => {
    applyMigrations(db);
    db.exec('DROP INDEX IF EXISTS idx_conversations_starred');
    db.exec('ALTER TABLE conversations DROP COLUMN starred');
    db.exec('DROP TABLE IF EXISTS code_graph_edges');
    db.exec('DROP TABLE IF EXISTS code_graph_nodes');
    db.exec('DROP INDEX IF EXISTS idx_checkpoint_entries_blob');
    db.exec('DROP TABLE IF EXISTS checkpoint_entries');
    db.exec('DROP TABLE IF EXISTS checkpoints');
    db.prepare('DELETE FROM schema_migrations WHERE version > 19').run();

    const before = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(before.v).toBe(19);

    applyMigrations(db);

    const after = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(after.v).toBeGreaterThanOrEqual(20);

    const cpTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'checkpoints'")
      .get() as { name: string } | undefined;
    expect(cpTable?.name).toBe('checkpoints');

    const entryTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'checkpoint_entries'")
      .get() as { name: string } | undefined;
    expect(entryTable?.name).toBe('checkpoint_entries');

    // FK cascade: deleting a checkpoint removes its entries.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO checkpoints (id, scope, workspace_root, kind, created_at)
       VALUES (?, 'turn', ?, 'content', ?)`,
    ).run('cp1', '/ws', now);
    db.prepare(
      `INSERT INTO checkpoint_entries (id, checkpoint_id, rel_path, pre_blob_sha, pre_size, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('e1', 'cp1', 'a.txt', 'sha', 3, now);

    db.prepare('DELETE FROM checkpoints WHERE id = ?').run('cp1');
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM checkpoint_entries WHERE checkpoint_id = ?')
      .get('cp1') as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('enforces scope/kind/status CHECK constraints', () => {
    applyMigrations(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO checkpoints (id, scope, workspace_root, kind) VALUES ('x', 'bogus', '/ws', 'content')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO checkpoints (id, scope, workspace_root, kind) VALUES ('x', 'turn', '/ws', 'bogus')`,
        )
        .run(),
    ).toThrow();
  });

  it('UNIQUE(checkpoint_id, rel_path) is enforced', () => {
    applyMigrations(db);
    db.prepare(
      `INSERT INTO checkpoints (id, scope, workspace_root, kind) VALUES ('cp', 'turn', '/ws', 'content')`,
    ).run();
    db.prepare(
      `INSERT INTO checkpoint_entries (id, checkpoint_id, rel_path, pre_size) VALUES ('e1', 'cp', 'a.txt', 0)`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO checkpoint_entries (id, checkpoint_id, rel_path, pre_size) VALUES ('e2', 'cp', 'a.txt', 0)`,
        )
        .run(),
    ).toThrow();
  });

  it('is idempotent at v20', () => {
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const after = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(after.v).toBeGreaterThanOrEqual(20);
  });
});
