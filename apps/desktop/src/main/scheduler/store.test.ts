import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import {
  createTask,
  deleteTask,
  getRun,
  getTask,
  listRuns,
  listTasks,
  recordRunCompletion,
  recordRunStart,
  setTaskRunBookkeeping,
  updateTask,
} from './store';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('scheduler store — tasks', () => {
  it('creates and reads back a task with a cron trigger', () => {
    const created = createTask({
      name: 'Nightly docs sync',
      description: 'sync docs',
      trigger: { type: 'cron', expr: '0 3 * * *' },
      prompt: 'sync stuff',
      providerId: 'openai',
      model: 'gpt-4o-mini',
      workspacePath: '/tmp/ws',
      allowedTools: ['read_file', 'grep'],
    });
    expect(created.id).toBeTruthy();
    expect(created.trigger.type).toBe('cron');
    expect(created.useWorktree).toBe(true);
    expect(created.enabled).toBe(true);
    expect(created.allowedTools).toEqual(['read_file', 'grep']);

    const fetched = getTask(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Nightly docs sync');
  });

  it('listTasks returns all tasks in created_at order', () => {
    const a = createTask({
      name: 'a',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const b = createTask({
      name: 'b',
      trigger: { type: 'cron', expr: '* * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const tasks = listTasks();
    expect(tasks.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('updateTask merges patches', () => {
    const t = createTask({
      name: 'orig',
      trigger: { type: 'cron', expr: '0 * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const updated = updateTask({
      id: t.id,
      name: 'renamed',
      enabled: false,
      trigger: { type: 'cron', expr: '*/15 * * * *' },
    });
    expect(updated.name).toBe('renamed');
    expect(updated.enabled).toBe(false);
    expect(updated.trigger).toEqual({ type: 'cron', expr: '*/15 * * * *' });
    expect(updated.prompt).toBe('p');
  });

  it('updateTask throws on unknown id', () => {
    expect(() => updateTask({ id: 'nope', name: 'x' })).toThrow(/unknown task/);
  });

  it('deleteTask removes the task and its runs cascade', () => {
    const t = createTask({
      name: 'a',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    recordRunStart({ taskId: t.id, status: 'running' });
    deleteTask(t.id);
    expect(getTask(t.id)).toBeNull();
    expect(listRuns({ taskId: t.id }).runs).toEqual([]);
  });

  it('setTaskRunBookkeeping updates only the provided fields', () => {
    const t = createTask({
      name: 'a',
      trigger: { type: 'cron', expr: '* * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    setTaskRunBookkeeping(t.id, {
      nextRunAt: '2026-05-26 10:00:00',
      lastStatus: 'completed',
      lastRunId: 'run-1',
    });
    const refreshed = getTask(t.id);
    expect(refreshed?.nextRunAt).toBe('2026-05-26 10:00:00');
    expect(refreshed?.lastStatus).toBe('completed');
    expect(refreshed?.lastRunId).toBe('run-1');
  });
});

describe('scheduler store — runs', () => {
  it('recordRunStart + recordRunCompletion round-trip', () => {
    const t = createTask({
      name: 'a',
      trigger: { type: 'cron', expr: '* * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const runId = recordRunStart({ taskId: t.id, status: 'running' });
    expect(runId).toBeTruthy();
    recordRunCompletion({
      runId,
      status: 'completed',
      agentRunId: 'agent-abc',
    });
    const r = getRun(runId);
    expect(r?.status).toBe('completed');
    expect(r?.agentRunId).toBe('agent-abc');
    expect(r?.completedAt).toBeTruthy();
  });

  it('listRuns paginates with beforeId cursor', () => {
    const t = createTask({
      name: 'a',
      trigger: { type: 'cron', expr: '* * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(recordRunStart({ taskId: t.id, status: 'completed' }));
    }
    const page1 = listRuns({ taskId: t.id, limit: 3 });
    expect(page1.runs).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    // Newest first
    expect(page1.runs[0]?.id).toBe(ids[6]);
    const page2 = listRuns({ taskId: t.id, limit: 3, beforeId: page1.nextCursor });
    expect(page2.runs).toHaveLength(3);
    expect(page2.runs[0]?.id).toBe(ids[3]);
    const page3 = listRuns({ taskId: t.id, limit: 3, beforeId: page2.nextCursor });
    expect(page3.runs).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it('listRuns is scoped per-task', () => {
    const a = createTask({
      name: 'a',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const b = createTask({
      name: 'b',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    recordRunStart({ taskId: a.id, status: 'running' });
    recordRunStart({ taskId: a.id, status: 'completed' });
    recordRunStart({ taskId: b.id, status: 'failed' });
    expect(listRuns({ taskId: a.id }).runs).toHaveLength(2);
    expect(listRuns({ taskId: b.id }).runs).toHaveLength(1);
  });

  it('was_catchup is preserved', () => {
    const t = createTask({
      name: 'a',
      trigger: { type: 'cron', expr: '* * * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/x',
    });
    const id = recordRunStart({ taskId: t.id, status: 'running', wasCatchup: true });
    expect(getRun(id)?.wasCatchup).toBe(true);
  });
});
