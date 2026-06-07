import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';
import { applyMigrations, setDbForTesting } from '../storage/db';
import {
  clearAllRuns,
  deleteRun,
  getRunById,
  listAllRuns,
  listRunningRuns,
  markStatus,
  upsertRun,
} from './run-store';

let db: Database.Database;

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    task: 'do the thing',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    runnerId: 'internal',
    status: 'running',
    startedAt: Date.parse('2026-05-25T10:00:00Z'),
    completedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    toolEvents: [],
    stopReason: null,
    error: null,
    worktreePath: null,
    worktreeBranch: null,
    worktreeRepoRoot: null,
    mergeStatus: null,
    triggerSource: 'user',
    seen: false,
    scheduledTaskId: null,
    ...overrides,
  };
}

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

describe('run-store', () => {
  it('upserts a row that round-trips through getRunById', () => {
    const run = makeRun({
      worktreePath: '/abs/wt',
      worktreeBranch: 'opencodex/subagent/abc',
      worktreeRepoRoot: '/abs/repo',
      mergeStatus: 'pending',
      inputTokens: 12,
      outputTokens: 34,
      iterations: 2,
    });
    upsertRun(run);
    const fetched = getRunById('run-1');
    expect(fetched).not.toBeNull();
    expect(fetched!.task).toBe('do the thing');
    expect(fetched!.providerId).toBe('openai');
    expect(fetched!.modelId).toBe('gpt-4o-mini');
    expect(fetched!.worktreePath).toBe('/abs/wt');
    expect(fetched!.worktreeBranch).toBe('opencodex/subagent/abc');
    expect(fetched!.worktreeRepoRoot).toBe('/abs/repo');
    expect(fetched!.mergeStatus).toBe('pending');
    expect(fetched!.inputTokens).toBe(12);
    expect(fetched!.outputTokens).toBe(34);
    expect(fetched!.iterations).toBe(2);
    expect(fetched!.status).toBe('running');
    expect(fetched!.runnerId).toBe('internal');
  });

  it('upsert is idempotent on the same id (UPDATE path)', () => {
    upsertRun(makeRun({ task: 'first', inputTokens: 1 }));
    upsertRun(makeRun({ task: 'second', inputTokens: 99 }));
    const fetched = getRunById('run-1');
    expect(fetched).not.toBeNull();
    expect(fetched!.task).toBe('second');
    expect(fetched!.inputTokens).toBe(99);
    expect(listAllRuns()).toHaveLength(1);
  });

  it('preserves tool events round-trip through timeline_json', () => {
    const run = makeRun({
      toolEvents: [
        { name: 'read_file', isError: false, durationMs: 10 },
        { name: 'grep', isError: true, durationMs: 30 },
      ],
      iterations: 2,
    });
    upsertRun(run);
    const fetched = getRunById('run-1');
    expect(fetched!.toolEvents).toHaveLength(2);
    expect(fetched!.toolEvents[0]).toEqual({
      name: 'read_file',
      isError: false,
      durationMs: 10,
    });
    expect(fetched!.toolEvents[1]).toEqual({
      name: 'grep',
      isError: true,
      durationMs: 30,
    });
  });

  it('listRunningRuns returns only status=running', () => {
    upsertRun(makeRun({ id: 'a', status: 'running' }));
    upsertRun(makeRun({ id: 'b', status: 'completed', completedAt: Date.now() }));
    upsertRun(makeRun({ id: 'c', status: 'failed', completedAt: Date.now() }));
    upsertRun(makeRun({ id: 'd', status: 'running' }));
    const ids = listRunningRuns()
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(['a', 'd']);
  });

  it('markStatus updates status, stop_reason, completed_at', () => {
    upsertRun(makeRun({ id: 'r', status: 'running' }));
    const completedAt = Date.parse('2026-05-25T10:05:00Z');
    markStatus('r', 'failed', 'runner_error', completedAt);
    const fetched = getRunById('r');
    expect(fetched!.status).toBe('failed');
    expect(fetched!.stopReason).toBe('runner_error');
    expect(fetched!.completedAt).toBe(completedAt);
  });

  it('deleteRun removes a row', () => {
    upsertRun(makeRun({ id: 'r' }));
    expect(getRunById('r')).not.toBeNull();
    deleteRun('r');
    expect(getRunById('r')).toBeNull();
  });

  it('clearAllRuns wipes everything', () => {
    upsertRun(makeRun({ id: 'a' }));
    upsertRun(makeRun({ id: 'b' }));
    clearAllRuns();
    expect(listAllRuns()).toEqual([]);
  });

  it('listAllRuns sorts by started_at DESC', () => {
    upsertRun(makeRun({ id: 'old', startedAt: Date.parse('2026-05-25T09:00:00Z') }));
    upsertRun(makeRun({ id: 'new', startedAt: Date.parse('2026-05-25T11:00:00Z') }));
    upsertRun(makeRun({ id: 'mid', startedAt: Date.parse('2026-05-25T10:00:00Z') }));
    const ids = listAllRuns().map((r) => r.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('records triggerSource=scheduled when set', () => {
    upsertRun(
      makeRun({
        id: 'sched',
        triggerSource: 'scheduled',
        scheduledTaskId: 'task-99',
      }),
    );
    const fetched = getRunById('sched');
    expect(fetched!.triggerSource).toBe('scheduled');
    expect(fetched!.scheduledTaskId).toBe('task-99');
  });

  it('round-trips the seen flag through upsert/getRunById', () => {
    upsertRun(makeRun({ id: 'unseen', seen: false }));
    upsertRun(makeRun({ id: 'seen', seen: true }));
    expect(getRunById('unseen')!.seen).toBe(false);
    expect(getRunById('seen')!.seen).toBe(true);
  });

  it('upsert ON CONFLICT updates seen from false to true', () => {
    upsertRun(makeRun({ id: 'r', seen: false }));
    expect(getRunById('r')!.seen).toBe(false);
    upsertRun(makeRun({ id: 'r', seen: true }));
    expect(getRunById('r')!.seen).toBe(true);
  });

  it('migration 18 defaults pre-existing rows to seen=0 (false)', () => {
    // Simulate a row written before the seen column existed by clearing it.
    upsertRun(makeRun({ id: 'legacy', seen: true }));
    db.prepare(`UPDATE agent_runs_persistent SET seen = 0 WHERE id = ?`).run('legacy');
    const fetched = getRunById('legacy');
    expect(fetched!.seen).toBe(false);
  });

  it('survives malformed timeline_json by falling back to defaults', () => {
    upsertRun(makeRun({ id: 'r' }));
    db.prepare(`UPDATE agent_runs_persistent SET timeline_json = 'not-json' WHERE id = ?`).run('r');
    const fetched = getRunById('r');
    expect(fetched).not.toBeNull();
    expect(fetched!.iterations).toBe(0);
    expect(fetched!.toolEvents).toEqual([]);
    expect(fetched!.mergeStatus).toBeNull();
  });
});
