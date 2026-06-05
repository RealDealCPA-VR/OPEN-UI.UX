import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Checkpoint,
  CheckpointEntry,
  CheckpointKind,
  CheckpointScope,
  CheckpointStatus,
} from '../../shared/checkpoints';
import { withSqliteBusyRetry } from '../util/sqlite-retry';
import { getDb } from './db';

interface RawCheckpointRow {
  id: string;
  scope: string;
  conversation_id: string | null;
  message_id: string | null;
  run_id: string | null;
  workspace_root: string;
  kind: string;
  git_base_sha: string | null;
  git_stash_ref: string | null;
  label: string | null;
  status: string;
  total_bytes: number;
  created_at: string;
  restored_at: string | null;
}

interface RawEntryRow {
  id: string;
  checkpoint_id: string;
  rel_path: string;
  pre_blob_sha: string | null;
  pre_size: number;
  captured_at: string;
}

const CHECKPOINT_COLUMNS = `id, scope, conversation_id, message_id, run_id, workspace_root, kind,
                            git_base_sha, git_stash_ref, label, status, total_bytes,
                            created_at, restored_at`;

const ENTRY_COLUMNS = `id, checkpoint_id, rel_path, pre_blob_sha, pre_size, captured_at`;

function rowToCheckpoint(row: RawCheckpointRow): Checkpoint {
  return {
    id: row.id,
    scope: row.scope as CheckpointScope,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    runId: row.run_id,
    workspaceRoot: row.workspace_root,
    kind: row.kind as CheckpointKind,
    gitBaseSha: row.git_base_sha,
    gitStashRef: row.git_stash_ref,
    label: row.label,
    status: row.status as CheckpointStatus,
    totalBytes: row.total_bytes,
    createdAt: row.created_at,
    restoredAt: row.restored_at,
  };
}

function rowToEntry(row: RawEntryRow): CheckpointEntry {
  return {
    id: row.id,
    checkpointId: row.checkpoint_id,
    relPath: row.rel_path,
    preBlobSha: row.pre_blob_sha,
    preSize: row.pre_size,
    capturedAt: row.captured_at,
  };
}

export interface CreateCheckpointInput {
  scope: CheckpointScope;
  conversationId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  workspaceRoot: string;
  kind: CheckpointKind;
  gitBaseSha?: string | null;
  gitStashRef?: string | null;
  label?: string | null;
}

export function createCheckpoint(
  input: CreateCheckpointInput,
  db: Database.Database = getDb(),
): string {
  const id = randomUUID();
  withSqliteBusyRetry(() =>
    db
      .prepare(
        `INSERT INTO checkpoints
         (id, scope, conversation_id, message_id, run_id, workspace_root, kind,
          git_base_sha, git_stash_ref, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.scope,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.runId ?? null,
        input.workspaceRoot,
        input.kind,
        input.gitBaseSha ?? null,
        input.gitStashRef ?? null,
        input.label ?? null,
      ),
  );
  return id;
}

export interface AddEntryInput {
  checkpointId: string;
  relPath: string;
  preBlobSha: string | null;
  preSize: number;
}

/** Insert a pre-image entry. First-pre-image-wins: OR IGNORE on the UNIQUE. */
export function addCheckpointEntry(input: AddEntryInput, db: Database.Database = getDb()): boolean {
  const id = randomUUID();
  const result = withSqliteBusyRetry(() =>
    db
      .prepare(
        `INSERT OR IGNORE INTO checkpoint_entries
         (id, checkpoint_id, rel_path, pre_blob_sha, pre_size)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.checkpointId, input.relPath, input.preBlobSha, input.preSize),
  );
  if (result.changes > 0) {
    withSqliteBusyRetry(() =>
      db
        .prepare('UPDATE checkpoints SET total_bytes = total_bytes + ? WHERE id = ?')
        .run(input.preSize, input.checkpointId),
    );
    return true;
  }
  return false;
}

export function hasEntryForPath(
  checkpointId: string,
  relPath: string,
  db: Database.Database = getDb(),
): boolean {
  const row = db
    .prepare('SELECT 1 AS n FROM checkpoint_entries WHERE checkpoint_id = ? AND rel_path = ?')
    .get(checkpointId, relPath) as { n: number } | undefined;
  return row !== undefined;
}

export function getCheckpoint(id: string, db: Database.Database = getDb()): Checkpoint | null {
  const row = db.prepare(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE id = ?`).get(id) as
    | RawCheckpointRow
    | undefined;
  return row ? rowToCheckpoint(row) : null;
}

export function getCheckpointEntries(
  checkpointId: string,
  db: Database.Database = getDb(),
): CheckpointEntry[] {
  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM checkpoint_entries WHERE checkpoint_id = ? ORDER BY rel_path ASC`,
    )
    .all(checkpointId) as RawEntryRow[];
  return rows.map(rowToEntry);
}

export function countCheckpointEntries(
  checkpointId: string,
  db: Database.Database = getDb(),
): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM checkpoint_entries WHERE checkpoint_id = ?')
    .get(checkpointId) as { n: number };
  return row.n;
}

/** Active turn checkpoint for a given assistant message, if one exists. */
export function findActiveTurnCheckpoint(
  messageId: string,
  db: Database.Database = getDb(),
): Checkpoint | null {
  const row = db
    .prepare(
      `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints
       WHERE scope = 'turn' AND message_id = ? AND status = 'active'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(messageId) as RawCheckpointRow | undefined;
  return row ? rowToCheckpoint(row) : null;
}

export function listCheckpointsForMessage(
  messageId: string,
  db: Database.Database = getDb(),
): Checkpoint[] {
  const rows = db
    .prepare(
      `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE message_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(messageId) as RawCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function listCheckpointsForRun(
  runId: string,
  db: Database.Database = getDb(),
): Checkpoint[] {
  const rows = db
    .prepare(
      `SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints WHERE run_id = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(runId) as RawCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function setCheckpointStatus(
  id: string,
  status: CheckpointStatus,
  db: Database.Database = getDb(),
): void {
  const restoredAt = status === 'restored' ? new Date().toISOString() : null;
  withSqliteBusyRetry(() =>
    db
      .prepare('UPDATE checkpoints SET status = ?, restored_at = ? WHERE id = ?')
      .run(status, restoredAt, id),
  );
}

/** All checkpoints ordered newest-first — for retention GC. */
export function listAllCheckpoints(db: Database.Database = getDb()): Checkpoint[] {
  const rows = db
    .prepare(`SELECT ${CHECKPOINT_COLUMNS} FROM checkpoints ORDER BY created_at DESC, rowid DESC`)
    .all() as RawCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function deleteCheckpoint(id: string, db: Database.Database = getDb()): void {
  withSqliteBusyRetry(() => db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id));
}
