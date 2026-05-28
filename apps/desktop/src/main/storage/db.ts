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
  {
    version: 3,
    sql: `
      ALTER TABLE messages ADD COLUMN content_blocks_json TEXT;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE tool_calls ADD COLUMN duration_ms INTEGER;
      ALTER TABLE tool_calls ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX idx_tool_calls_message ON tool_calls(message_id);
      CREATE INDEX idx_tool_calls_tool_name ON tool_calls(tool_name);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE VIRTUAL TABLE indexed_files USING fts5(
        path,
        content,
        tokenize='unicode61'
      );

      CREATE TABLE indexed_files_meta (
        path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        trigger_json TEXT NOT NULL,
        prompt TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        use_worktree INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT,
        last_status TEXT,
        last_run_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
      CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);

      CREATE TABLE scheduled_task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        status TEXT NOT NULL,
        agent_run_id TEXT,
        error_message TEXT,
        was_catchup INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_scheduled_task_runs_task ON scheduled_task_runs(task_id);
      CREATE INDEX idx_scheduled_task_runs_started ON scheduled_task_runs(started_at);
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE tool_calls ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'user';
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE scheduled_tasks ADD COLUMN linked_skill_id TEXT;
      CREATE INDEX idx_scheduled_tasks_linked_skill ON scheduled_tasks(linked_skill_id);
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE scheduled_tasks ADD COLUMN runner_id TEXT;
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE tool_calls ADD COLUMN runner_id TEXT;
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
