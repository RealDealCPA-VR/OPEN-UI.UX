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
  {
    version: 11,
    sql: `
      CREATE TABLE budgets (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('global','conversation','provider')),
        scope_id TEXT,
        period TEXT NOT NULL CHECK (period IN ('conversation','day','month')),
        amount_usd REAL NOT NULL,
        warn_threshold_pct INTEGER NOT NULL DEFAULT 80,
        hard_stop INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_budgets_scope ON budgets(scope, scope_id);

      CREATE TABLE budget_spend (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
        conversation_id TEXT,
        period_key TEXT NOT NULL,
        spent_usd REAL NOT NULL DEFAULT 0,
        UNIQUE(budget_id, period_key)
      );
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE agent_runs_persistent (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        stop_reason TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        repo_root TEXT,
        runner_id TEXT,
        trigger_source TEXT NOT NULL DEFAULT 'user',
        scheduled_task_id TEXT,
        parent_run_id TEXT,
        timeline_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX idx_agent_runs_status ON agent_runs_persistent(status);
      CREATE INDEX idx_agent_runs_parent ON agent_runs_persistent(parent_run_id);
    `,
  },
  {
    version: 13,
    sql: `
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        conversation_id UNINDEXED,
        message_id UNINDEXED,
        content,
        tokenize='unicode61'
      );
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        display_name TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        rag_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE conversation_workspaces (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, workspace_id)
      );
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE applied_diffs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        tool_call_id TEXT,
        file_path TEXT NOT NULL,
        diff TEXT NOT NULL,
        prompt_snapshot TEXT,
        rag_citations_json TEXT,
        routing_decision_json TEXT,
        provider_id TEXT,
        model_id TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        cost_usd REAL,
        seed INTEGER,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_applied_diffs_conv ON applied_diffs(conversation_id);
      CREATE INDEX idx_applied_diffs_file ON applied_diffs(file_path);
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE tool_calls ADD COLUMN routing_decision_json TEXT;
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE messages ADD COLUMN cached_input_tokens INTEGER;
    `,
  },
  {
    version: 18,
    sql: 'ALTER TABLE agent_runs_persistent ADD COLUMN seen INTEGER NOT NULL DEFAULT 0;',
  },
  {
    version: 19,
    sql: `
      ALTER TABLE messages ADD COLUMN turn_status TEXT NOT NULL DEFAULT 'final';
      CREATE INDEX idx_messages_turn_status ON messages(turn_status) WHERE turn_status = 'streaming';
    `,
  },
  {
    version: 20,
    sql: `
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('turn','run')),
        conversation_id TEXT,
        message_id TEXT,
        run_id TEXT,
        workspace_root TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('content','git')),
        git_base_sha TEXT,
        git_stash_ref TEXT,
        label TEXT,
        status TEXT NOT NULL CHECK (status IN ('active','restored','superseded')) DEFAULT 'active',
        total_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        restored_at TEXT
      );

      CREATE INDEX idx_checkpoints_message ON checkpoints(message_id);
      CREATE INDEX idx_checkpoints_run ON checkpoints(run_id);
      CREATE INDEX idx_checkpoints_conversation ON checkpoints(conversation_id);

      CREATE TABLE checkpoint_entries (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        pre_blob_sha TEXT,
        pre_size INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(checkpoint_id, rel_path)
      );

      CREATE INDEX idx_checkpoint_entries_blob ON checkpoint_entries(pre_blob_sha);
    `,
  },
  {
    version: 21,
    sql: `
      CREATE TABLE code_graph_nodes (
        workspace_id TEXT NOT NULL,
        id TEXT NOT NULL,
        label TEXT NOT NULL,
        file_type TEXT NOT NULL,
        source_file TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        language TEXT,
        kind TEXT,
        community INTEGER,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE INDEX idx_code_graph_nodes_workspace ON code_graph_nodes(workspace_id);
      CREATE INDEX idx_code_graph_nodes_label ON code_graph_nodes(workspace_id, label);
      CREATE INDEX idx_code_graph_nodes_community ON code_graph_nodes(workspace_id, community);

      CREATE TABLE code_graph_edges (
        workspace_id TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL,
        confidence TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        weight REAL NOT NULL,
        source_file TEXT NOT NULL
      );

      CREATE INDEX idx_code_graph_edges_source ON code_graph_edges(workspace_id, source);
      CREATE INDEX idx_code_graph_edges_target ON code_graph_edges(workspace_id, target);
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE conversations ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_conversations_starred ON conversations(starred) WHERE starred = 1;
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

const MAX_SUPPORTED_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

export class UnsupportedSchemaVersionError extends Error {
  override readonly name = 'UnsupportedSchemaVersionError';
  constructor(
    readonly currentVersion: number,
    readonly maxSupported: number,
  ) {
    super(
      `Database schema version ${currentVersion} was written by a newer build of OpenCodex (this build supports up to ${maxSupported}). Downgrading is not supported — please reopen with the newer build or remove the database file to start fresh.`,
    );
  }
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

  if (current > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(current, MAX_SUPPORTED_SCHEMA_VERSION);
  }

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
