import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './db';
import { createConversation, getConversation, setConversationProject } from './conversations';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectInstructionsForConversation,
  listProjects,
  renameProject,
  setProjectInstructions,
} from './projects';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

describe('projects storage', () => {
  it('creates a project with empty instructions', () => {
    const p = createProject('  Acme Site  ', db);
    expect(p.name).toBe('Acme Site');
    expect(p.instructions).toBe('');
    expect(p.createdAt).toBeTruthy();
    expect(getProject(p.id, db)).toEqual(p);
  });

  it('rejects empty project names', () => {
    expect(() => createProject('   ', db)).toThrow();
  });

  it('lists projects alphabetically (case-insensitive)', () => {
    createProject('zeta', db);
    createProject('Alpha', db);
    createProject('beta', db);
    expect(listProjects(db).map((p) => p.name)).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('renames a project and rejects unknown ids', () => {
    const p = createProject('old', db);
    expect(renameProject(p.id, 'new name', db).name).toBe('new name');
    expect(() => renameProject('missing', 'x', db)).toThrow();
  });

  it('sets instructions and reads them back', () => {
    const p = createProject('docs', db);
    const updated = setProjectInstructions(p.id, 'Always answer in French.', db);
    expect(updated.instructions).toBe('Always answer in French.');
    expect(() => setProjectInstructions('missing', 'x', db)).toThrow();
  });

  it('assigns and unassigns a conversation', () => {
    const p = createProject('proj', db);
    const c = createConversation({}, db);
    expect(c.projectId).toBeNull();

    const assigned = setConversationProject(c.id, p.id, db);
    expect(assigned.projectId).toBe(p.id);
    expect(getConversation(c.id, db)?.projectId).toBe(p.id);

    const unassigned = setConversationProject(c.id, null, db);
    expect(unassigned.projectId).toBeNull();
  });

  it('rejects assigning to a nonexistent project or conversation', () => {
    const c = createConversation({}, db);
    expect(() => setConversationProject(c.id, 'no-such-project', db)).toThrow();
    const p = createProject('proj', db);
    expect(() => setConversationProject('no-such-conversation', p.id, db)).toThrow();
  });

  it('deleting a project unassigns its conversations without deleting them', () => {
    const p = createProject('doomed', db);
    const a = setConversationProject(createConversation({ title: 'a' }, db).id, p.id, db);
    const b = setConversationProject(createConversation({ title: 'b' }, db).id, p.id, db);

    deleteProject(p.id, db);

    expect(getProject(p.id, db)).toBeNull();
    expect(getConversation(a.id, db)?.projectId).toBeNull();
    expect(getConversation(b.id, db)?.projectId).toBeNull();
    expect(getConversation(a.id, db)?.title).toBe('a');
  });

  it('returns project instructions for an assigned conversation', () => {
    const p = createProject('proj', db);
    setProjectInstructions(p.id, '  Use tabs not spaces.  ', db);
    const c = createConversation({}, db);
    setConversationProject(c.id, p.id, db);
    expect(getProjectInstructionsForConversation(c.id, db)).toBe('Use tabs not spaces.');
  });

  it('returns null instructions for unassigned conversations or blank instructions', () => {
    const c = createConversation({}, db);
    expect(getProjectInstructionsForConversation(c.id, db)).toBeNull();

    const p = createProject('proj', db);
    setConversationProject(c.id, p.id, db);
    expect(getProjectInstructionsForConversation(c.id, db)).toBeNull();

    setProjectInstructions(p.id, '   ', db);
    expect(getProjectInstructionsForConversation(c.id, db)).toBeNull();
  });
});
