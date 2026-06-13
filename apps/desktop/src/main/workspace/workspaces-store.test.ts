import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import { applyMigrations } from '../storage/db';
import {
  createWorkspace,
  deleteWorkspace,
  getPrimaryWorkspace,
  getWorkspaceById,
  linkConversation,
  listWorkspaces,
  listWorkspacesForConversation,
  setPrimary,
  setRagEnabled,
  unlinkConversation,
  WorkspaceNotFoundError,
  WorkspacePathError,
} from './workspaces-store';

let db: Database.Database;
let tmpA: string;
let tmpB: string;

async function mkTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function seedConversation(id: string): void {
  db.prepare(`INSERT INTO conversations (id, title) VALUES (?, ?)`).run(id, `conv ${id}`);
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  tmpA = await mkTempDir('opencodex-ws-a-');
  tmpB = await mkTempDir('opencodex-ws-b-');
});

afterEach(async () => {
  db.close();
  await Promise.all([rmTmp(tmpA), rmTmp(tmpB)]);
});

describe('workspaces-store', () => {
  it('rejects non-existing directory paths', () => {
    expect(() => createWorkspace({ path: path.join(tmpA, 'does-not-exist') }, db)).toThrow(
      WorkspacePathError,
    );
  });

  it('creates a workspace and marks it primary by default', () => {
    const created = createWorkspace({ path: tmpA, displayName: 'A' }, db);
    expect(created.path).toBe(path.resolve(tmpA));
    expect(created.displayName).toBe('A');
    expect(created.isPrimary).toBe(true);
    expect(created.ragEnabled).toBe(true);

    const primary = getPrimaryWorkspace(db);
    expect(primary?.id).toBe(created.id);
  });

  it('returns the existing workspace on duplicate path inserts', () => {
    const first = createWorkspace({ path: tmpA }, db);
    const again = createWorkspace({ path: tmpA, displayName: 'rename' }, db);
    expect(again.id).toBe(first.id);
    expect(listWorkspaces(db)).toHaveLength(1);
  });

  it('promotes the explicit setPrimary candidate over existing primary', () => {
    const first = createWorkspace({ path: tmpA }, db);
    const second = createWorkspace({ path: tmpB, setPrimary: true }, db);
    const list = listWorkspaces(db);
    expect(getPrimaryWorkspace(db)?.id).toBe(second.id);
    expect(list.find((w) => w.id === first.id)?.isPrimary).toBe(false);
  });

  it('setPrimary moves the primary flag exclusively', () => {
    const first = createWorkspace({ path: tmpA }, db);
    const second = createWorkspace({ path: tmpB }, db);
    setPrimary(second.id, db);
    expect(getPrimaryWorkspace(db)?.id).toBe(second.id);
    expect(getWorkspaceById(first.id, db)?.isPrimary).toBe(false);
  });

  it('setPrimary throws WorkspaceNotFoundError for unknown ids', () => {
    expect(() => setPrimary('nope', db)).toThrow(WorkspaceNotFoundError);
  });

  it('setRagEnabled flips the rag_enabled column', () => {
    const ws = createWorkspace({ path: tmpA }, db);
    const updated = setRagEnabled(ws.id, false, db);
    expect(updated.ragEnabled).toBe(false);
  });

  it('promotes another workspace to primary when the primary is deleted', () => {
    const first = createWorkspace({ path: tmpA }, db);
    const second = createWorkspace({ path: tmpB }, db);
    expect(getPrimaryWorkspace(db)?.id).toBe(first.id);
    deleteWorkspace(first.id, db);
    expect(getPrimaryWorkspace(db)?.id).toBe(second.id);
  });

  it('deleteWorkspace throws when the workspace does not exist', () => {
    expect(() => deleteWorkspace('missing', db)).toThrow(WorkspaceNotFoundError);
  });

  it('linkConversation idempotently associates a workspace with a conversation', () => {
    seedConversation('c1');
    const ws = createWorkspace({ path: tmpA }, db);
    linkConversation('c1', ws.id, db);
    linkConversation('c1', ws.id, db); // should be a no-op via INSERT OR IGNORE
    const linked = listWorkspacesForConversation('c1', db);
    expect(linked.map((w) => w.id)).toEqual([ws.id]);
  });

  it('unlinkConversation removes the association', () => {
    seedConversation('c1');
    const ws = createWorkspace({ path: tmpA }, db);
    linkConversation('c1', ws.id, db);
    unlinkConversation('c1', ws.id, db);
    expect(listWorkspacesForConversation('c1', db)).toEqual([]);
  });

  it('linkConversation rejects unknown workspace ids', () => {
    seedConversation('c1');
    expect(() => linkConversation('c1', 'nope', db)).toThrow(WorkspaceNotFoundError);
  });

  it('deleting a workspace cascades to conversation_workspaces', () => {
    seedConversation('c1');
    const ws = createWorkspace({ path: tmpA }, db);
    linkConversation('c1', ws.id, db);
    deleteWorkspace(ws.id, db);
    expect(listWorkspacesForConversation('c1', db)).toEqual([]);
  });

  it('listWorkspaces returns primary first', () => {
    createWorkspace({ path: tmpA }, db);
    const second = createWorkspace({ path: tmpB, setPrimary: true }, db);
    const list = listWorkspaces(db);
    expect(list[0]?.id).toBe(second.id);
  });
});
