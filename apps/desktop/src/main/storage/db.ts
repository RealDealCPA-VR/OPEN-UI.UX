import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { logger } from '../logger';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_messages_conversation ON messages(conversation_id);

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        decision TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE conversations ADD COLUMN provider_id TEXT;
      ALTER TABLE conversations ADD COLUMN model_id TEXT;

      ALTER TABLE messages ADD COLUMN provider_id TEXT;
      ALTER TABLE messages ADD COLUMN model_id TEXT;
      ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
      ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
      ALTER TABLE messages ADD COLUMN cost_usd REAL;
    `,
  },
];

let db: Database.Database | null = null;

export function openDb(): Database.Database {
  if (db) return db;
  const dbPath = join(app.getPath('userData'), 'opencodex.db');
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  applyMigrations(instance);
  db = instance;
  logger.info({ path: dbPath }, 'sqlite opened');
  return instance;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('db not initialized — call openDb() first');
  return db;
}

export function setDbForTesting(instance: Database.Database | null): void {
  db = instance;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function applyMigrations(database: Database.Database): void {
  runMigrations(database);
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const currentRow = database
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null };
  const current = currentRow.version ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) return;

  const apply = database.transaction((migrations: readonly Migration[]) => {
    for (const m of migrations) {
      database.exec(m.sql);
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
      logger.info({ version: m.version }, 'migration applied');
    }
  });
  apply(pending);
}
