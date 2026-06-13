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

describe('migration v19 — turn_status', () => {
  it('upgrades cleanly from v16 to v19 adding turn_status (default final) + partial index', () => {
    // Simulate a database written by an older build that stopped at v16 by
    // running every migration, then rolling the recorded version back to 16 and
    // dropping the v17/v18/v19 artifacts so the upgrade path is exercised.
    applyMigrations(db);
    db.exec('DROP INDEX IF EXISTS idx_conversations_project');
    db.exec('ALTER TABLE conversations DROP COLUMN project_id');
    db.exec('DROP TABLE IF EXISTS projects');
    db.exec('DROP INDEX IF EXISTS idx_conversations_starred');
    db.exec('ALTER TABLE conversations DROP COLUMN starred');
    db.exec('DROP TABLE IF EXISTS code_graph_edges');
    db.exec('DROP TABLE IF EXISTS code_graph_nodes');
    db.exec('DROP INDEX IF EXISTS idx_checkpoint_entries_blob');
    db.exec('DROP TABLE IF EXISTS checkpoint_entries');
    db.exec('DROP TABLE IF EXISTS checkpoints');
    db.exec('DROP INDEX IF EXISTS idx_messages_turn_status');
    db.exec('ALTER TABLE messages DROP COLUMN turn_status');
    db.exec('ALTER TABLE messages DROP COLUMN cached_input_tokens');
    db.exec('ALTER TABLE agent_runs_persistent DROP COLUMN seen');
    db.prepare('DELETE FROM schema_migrations WHERE version > 16').run();

    const before = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(before.v).toBe(16);

    applyMigrations(db);

    const after = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(after.v).toBeGreaterThanOrEqual(19);

    // Column exists and defaults to 'final'.
    const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    const turnCol = cols.find((c) => c.name === 'turn_status');
    expect(turnCol).toBeDefined();
    expect(turnCol?.dflt_value).toMatch(/final/);

    // Partial index exists.
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
      .get('idx_messages_turn_status') as { name: string } | undefined;
    expect(idx?.name).toBe('idx_messages_turn_status');

    // A new conversation + message round-trips with the default.
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('c1', 't', now, now);
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('m1', 'c1', 'assistant', 'hi', now);
    const row = db.prepare('SELECT turn_status FROM messages WHERE id = ?').get('m1') as {
      turn_status: string;
    };
    expect(row.turn_status).toBe('final');
  });

  it('is idempotent at v19', () => {
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    const after = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
      v: number;
    };
    expect(after.v).toBeGreaterThanOrEqual(19);
  });
});
