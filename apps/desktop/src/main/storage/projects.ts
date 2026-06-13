import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Project } from '../../shared/projects';
import { withSqliteBusyRetry } from '../util/sqlite-retry';
import { getDb } from './db';

interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
}

const PROJECT_COLUMNS = 'id, name, instructions, created_at';

const MAX_NAME_LENGTH = 200;
const MAX_INSTRUCTIONS_LENGTH = 20_000;

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    createdAt: row.created_at,
  };
}

export function listProjects(db: Database.Database = getDb()): Project[] {
  const rows = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY name COLLATE NOCASE ASC, id ASC`)
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string, db: Database.Database = getDb()): Project | null {
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(name: string, db: Database.Database = getDb()): Project {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) throw new Error('project name cannot be empty');
  const id = randomUUID();
  const now = new Date().toISOString();
  withSqliteBusyRetry(() =>
    db
      .prepare(`INSERT INTO projects (id, name, instructions, created_at) VALUES (?, ?, '', ?)`)
      .run(id, trimmed, now),
  );
  const project = getProject(id, db);
  if (!project) throw new Error('failed to create project');
  return project;
}

export function renameProject(id: string, name: string, db: Database.Database = getDb()): Project {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) throw new Error('project name cannot be empty');
  const result = withSqliteBusyRetry(() =>
    db.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run(trimmed, id),
  );
  if (result.changes === 0) throw new Error(`project ${id} not found`);
  const project = getProject(id, db);
  if (!project) throw new Error(`project ${id} not found after rename`);
  return project;
}

export function setProjectInstructions(
  id: string,
  instructions: string,
  db: Database.Database = getDb(),
): Project {
  const capped = instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);
  const result = withSqliteBusyRetry(() =>
    db.prepare(`UPDATE projects SET instructions = ? WHERE id = ?`).run(capped, id),
  );
  if (result.changes === 0) throw new Error(`project ${id} not found`);
  const project = getProject(id, db);
  if (!project) throw new Error(`project ${id} not found after update`);
  return project;
}

/** Deleting a project keeps its conversations — they just become unassigned. */
export function deleteProject(id: string, db: Database.Database = getDb()): void {
  const tx = db.transaction(() => {
    // Explicit unassign rather than relying on the FK's ON DELETE SET NULL, so
    // behaviour is identical even when foreign_keys is off for a connection.
    db.prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });
  withSqliteBusyRetry(() => tx());
}

/**
 * Instructions of the project the conversation belongs to, or null when the
 * conversation is unassigned / the instructions are blank. Used by the chat
 * system-prompt builder.
 */
export function getProjectInstructionsForConversation(
  conversationId: string,
  db: Database.Database = getDb(),
): string | null {
  const row = db
    .prepare(
      `SELECT p.instructions AS instructions
         FROM conversations c
         JOIN projects p ON p.id = c.project_id
        WHERE c.id = ?`,
    )
    .get(conversationId) as { instructions: string } | undefined;
  const trimmed = row?.instructions.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
