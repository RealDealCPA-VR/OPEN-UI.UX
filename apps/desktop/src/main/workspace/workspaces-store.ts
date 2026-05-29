import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../storage/db';
import type { WorkspaceEntry } from '../../shared/workspaces';

interface WorkspaceRow {
  id: string;
  path: string;
  display_name: string | null;
  is_primary: number;
  rag_enabled: number;
  created_at: string;
}

function rowToEntry(row: WorkspaceRow): WorkspaceEntry {
  return {
    id: row.id,
    path: row.path,
    displayName: row.display_name,
    isPrimary: row.is_primary === 1,
    ragEnabled: row.rag_enabled === 1,
    createdAt: row.created_at,
  };
}

export function isExistingDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface CreateWorkspaceInput {
  path: string;
  displayName?: string | undefined;
  ragEnabled?: boolean | undefined;
  setPrimary?: boolean | undefined;
}

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace not found: ${id}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export function listWorkspaces(db: Database.Database = getDb()): WorkspaceEntry[] {
  const rows = db
    .prepare(
      `SELECT id, path, display_name, is_primary, rag_enabled, created_at
       FROM workspaces
       ORDER BY is_primary DESC, created_at ASC`,
    )
    .all() as WorkspaceRow[];
  return rows.map(rowToEntry);
}

export function getWorkspaceById(
  id: string,
  db: Database.Database = getDb(),
): WorkspaceEntry | null {
  const row = db
    .prepare(
      `SELECT id, path, display_name, is_primary, rag_enabled, created_at
       FROM workspaces WHERE id = ?`,
    )
    .get(id) as WorkspaceRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function getWorkspaceByPath(
  path: string,
  db: Database.Database = getDb(),
): WorkspaceEntry | null {
  const row = db
    .prepare(
      `SELECT id, path, display_name, is_primary, rag_enabled, created_at
       FROM workspaces WHERE path = ?`,
    )
    .get(path) as WorkspaceRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function getPrimaryWorkspace(db: Database.Database = getDb()): WorkspaceEntry | null {
  const row = db
    .prepare(
      `SELECT id, path, display_name, is_primary, rag_enabled, created_at
       FROM workspaces WHERE is_primary = 1 LIMIT 1`,
    )
    .get() as WorkspaceRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function createWorkspace(
  input: CreateWorkspaceInput,
  db: Database.Database = getDb(),
): WorkspaceEntry {
  const resolved = resolve(input.path);
  if (!isExistingDirectory(resolved)) {
    throw new WorkspacePathError(`Path is not an existing directory: ${resolved}`);
  }
  const existing = getWorkspaceByPath(resolved, db);
  if (existing) {
    if (input.setPrimary) {
      setPrimary(existing.id, db);
      return getWorkspaceById(existing.id, db) ?? existing;
    }
    return existing;
  }

  const id = randomUUID();
  const displayName = input.displayName ?? null;
  const ragEnabled = input.ragEnabled === false ? 0 : 1;
  const shouldBePrimary = input.setPrimary === true;

  const tx = db.transaction(() => {
    if (shouldBePrimary) {
      db.prepare(`UPDATE workspaces SET is_primary = 0 WHERE is_primary = 1`).run();
    }
    db.prepare(
      `INSERT INTO workspaces (id, path, display_name, is_primary, rag_enabled)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, resolved, displayName, shouldBePrimary ? 1 : 0, ragEnabled);

    // If nothing was primary before, make this one primary by default.
    const primaryCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM workspaces WHERE is_primary = 1`).get() as { n: number }
    ).n;
    if (primaryCount === 0) {
      db.prepare(`UPDATE workspaces SET is_primary = 1 WHERE id = ?`).run(id);
    }
  });
  tx();
  const created = getWorkspaceById(id, db);
  if (!created) throw new Error('failed to create workspace');
  return created;
}

export function deleteWorkspace(id: string, db: Database.Database = getDb()): void {
  const target = getWorkspaceById(id, db);
  if (!target) throw new WorkspaceNotFoundError(id);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
    // If the deleted workspace was primary, promote another (the oldest).
    if (target.isPrimary) {
      const next = db.prepare(`SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`).get() as
        | { id: string }
        | undefined;
      if (next) {
        db.prepare(`UPDATE workspaces SET is_primary = 1 WHERE id = ?`).run(next.id);
      }
    }
  });
  tx();
}

export function setPrimary(id: string, db: Database.Database = getDb()): WorkspaceEntry {
  const target = getWorkspaceById(id, db);
  if (!target) throw new WorkspaceNotFoundError(id);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE workspaces SET is_primary = 0 WHERE is_primary = 1`).run();
    db.prepare(`UPDATE workspaces SET is_primary = 1 WHERE id = ?`).run(id);
  });
  tx();
  const updated = getWorkspaceById(id, db);
  if (!updated) throw new WorkspaceNotFoundError(id);
  return updated;
}

export function setRagEnabled(
  id: string,
  enabled: boolean,
  db: Database.Database = getDb(),
): WorkspaceEntry {
  const target = getWorkspaceById(id, db);
  if (!target) throw new WorkspaceNotFoundError(id);
  db.prepare(`UPDATE workspaces SET rag_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
  const updated = getWorkspaceById(id, db);
  if (!updated) throw new WorkspaceNotFoundError(id);
  return updated;
}

export function linkConversation(
  conversationId: string,
  workspaceId: string,
  db: Database.Database = getDb(),
): void {
  if (!getWorkspaceById(workspaceId, db)) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
  db.prepare(
    `INSERT OR IGNORE INTO conversation_workspaces (conversation_id, workspace_id) VALUES (?, ?)`,
  ).run(conversationId, workspaceId);
}

export function unlinkConversation(
  conversationId: string,
  workspaceId: string,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `DELETE FROM conversation_workspaces WHERE conversation_id = ? AND workspace_id = ?`,
  ).run(conversationId, workspaceId);
}

export function listWorkspacesForConversation(
  conversationId: string,
  db: Database.Database = getDb(),
): WorkspaceEntry[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.path, w.display_name, w.is_primary, w.rag_enabled, w.created_at
       FROM workspaces w
       INNER JOIN conversation_workspaces cw ON cw.workspace_id = w.id
       WHERE cw.conversation_id = ?
       ORDER BY w.is_primary DESC, w.created_at ASC`,
    )
    .all(conversationId) as WorkspaceRow[];
  return rows.map(rowToEntry);
}

export function unlinkAllForConversation(
  conversationId: string,
  db: Database.Database = getDb(),
): void {
  db.prepare(`DELETE FROM conversation_workspaces WHERE conversation_id = ?`).run(conversationId);
}
