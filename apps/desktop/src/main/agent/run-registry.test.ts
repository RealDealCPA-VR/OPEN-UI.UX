import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  clear,
  getRun,
  listRuns,
  onRunsChanged,
  recordComplete,
  recordError,
  recordStart,
  setMergeStatus,
} from './run-registry';
import type { SubagentResult } from './subagent';

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    text: 'done',
    toolEvents: [
      { name: 'read_file', input: {}, output: 'x', isError: false, durationMs: 12 },
      { name: 'grep', input: {}, output: 'y', isError: true, durationMs: 30 },
    ],
    inputTokens: 100,
    outputTokens: 50,
    stopReason: 'end_turn',
    iterations: 2,
    ...overrides,
  };
}

describe('run-registry', () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    __resetForTests();
    vi.useRealTimers();
  });

  it('records a running run on recordStart', () => {
    const id = recordStart({ task: 't', providerId: 'openai', modelId: 'gpt-4o-mini' });
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.id).toBe(id);
    expect(run.status).toBe('running');
    expect(run.task).toBe('t');
    expect(run.providerId).toBe('openai');
    expect(run.modelId).toBe('gpt-4o-mini');
    expect(run.completedAt).toBeNull();
    expect(run.toolEvents).toEqual([]);
    expect(run.stopReason).toBeNull();
    expect(run.error).toBeNull();
  });

  it('recordComplete marks status completed and copies tokens + tool events', () => {
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    recordComplete(id, makeResult());
    const [run] = listRuns();
    expect(run!.status).toBe('completed');
    expect(run!.inputTokens).toBe(100);
    expect(run!.outputTokens).toBe(50);
    expect(run!.iterations).toBe(2);
    expect(run!.stopReason).toBe('end_turn');
    expect(run!.toolEvents).toHaveLength(2);
    expect(run!.toolEvents[0]).toEqual({ name: 'read_file', isError: false, durationMs: 12 });
    expect(run!.toolEvents[1]).toEqual({ name: 'grep', isError: true, durationMs: 30 });
    expect(run!.completedAt).not.toBeNull();
  });

  it('recordComplete marks failed when stopReason is error or budget_exceeded', () => {
    const id1 = recordStart({ task: 'a', providerId: 'p', modelId: 'm' });
    recordComplete(id1, makeResult({ stopReason: 'error', error: 'boom' }));
    const id2 = recordStart({ task: 'b', providerId: 'p', modelId: 'm' });
    recordComplete(id2, makeResult({ stopReason: 'budget_exceeded' }));
    const runs = listRuns();
    const byId = new Map(runs.map((r) => [r.id, r]));
    expect(byId.get(id1)!.status).toBe('failed');
    expect(byId.get(id1)!.error).toBe('boom');
    expect(byId.get(id2)!.status).toBe('failed');
    expect(byId.get(id2)!.error).toBeNull();
  });

  it('recordError marks failed with message', () => {
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    recordError(id, new Error('nope'));
    const [run] = listRuns();
    expect(run!.status).toBe('failed');
    expect(run!.stopReason).toBe('error');
    expect(run!.error).toBe('nope');
  });

  it('recordComplete/recordError on unknown id is a no-op', () => {
    recordComplete('missing', makeResult());
    recordError('missing', new Error('x'));
    expect(listRuns()).toEqual([]);
  });

  it('listRuns returns newest first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T10:00:00Z'));
    const a = recordStart({ task: 'a', providerId: 'p', modelId: 'm' });
    vi.setSystemTime(new Date('2026-05-25T10:00:01Z'));
    const b = recordStart({ task: 'b', providerId: 'p', modelId: 'm' });
    vi.setSystemTime(new Date('2026-05-25T10:00:02Z'));
    const c = recordStart({ task: 'c', providerId: 'p', modelId: 'm' });
    const runs = listRuns();
    expect(runs.map((r) => r.id)).toEqual([c, b, a]);
  });

  it('onRunsChanged fires on start, complete, error, and clear', () => {
    const listener = vi.fn();
    const off = onRunsChanged(listener);
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    expect(listener).toHaveBeenCalledTimes(1);
    recordComplete(id, makeResult());
    expect(listener).toHaveBeenCalledTimes(2);
    const id2 = recordStart({ task: 't2', providerId: 'p', modelId: 'm' });
    recordError(id2, new Error('x'));
    expect(listener).toHaveBeenCalledTimes(4);
    clear();
    expect(listener).toHaveBeenCalledTimes(5);
    expect(listRuns()).toEqual([]);
    off();
  });

  it('onRunsChanged returns an unsubscribe function', () => {
    const listener = vi.fn();
    const off = onRunsChanged(listener);
    off();
    recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('records worktree fields when provided and marks mergeStatus pending', () => {
    const id = recordStart({
      task: 't',
      providerId: 'p',
      modelId: 'm',
      worktreePath: '/abs/path/wt',
      worktreeBranch: 'opencodex/subagent/abc',
      worktreeRepoRoot: '/abs/repo',
    });
    const run = getRun(id);
    expect(run).toBeDefined();
    expect(run!.worktreePath).toBe('/abs/path/wt');
    expect(run!.worktreeBranch).toBe('opencodex/subagent/abc');
    expect(run!.worktreeRepoRoot).toBe('/abs/repo');
    expect(run!.mergeStatus).toBe('pending');
  });

  it('leaves worktree fields null and mergeStatus null when not provided', () => {
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    const run = getRun(id);
    expect(run!.worktreePath).toBeNull();
    expect(run!.worktreeBranch).toBeNull();
    expect(run!.worktreeRepoRoot).toBeNull();
    expect(run!.mergeStatus).toBeNull();
  });

  it('setMergeStatus updates the run and is a no-op for unknown id', () => {
    const id = recordStart({
      task: 't',
      providerId: 'p',
      modelId: 'm',
      worktreePath: '/x',
      worktreeBranch: 'b',
      worktreeRepoRoot: '/r',
    });
    setMergeStatus(id, 'merged');
    expect(getRun(id)!.mergeStatus).toBe('merged');
    setMergeStatus(id, 'rejected');
    expect(getRun(id)!.mergeStatus).toBe('rejected');
    setMergeStatus('missing', 'merged');
    expect(getRun('missing')).toBeUndefined();
  });

  it('caps history at MAX_RUNS (100), evicting oldest', () => {
    for (let i = 0; i < 105; i++) {
      recordStart({ task: `t${i}`, providerId: 'p', modelId: 'm' });
    }
    const runs = listRuns();
    expect(runs).toHaveLength(100);
    const tasks = runs.map((r) => r.task);
    expect(tasks).not.toContain('t0');
    expect(tasks).not.toContain('t4');
    expect(tasks).toContain('t5');
    expect(tasks).toContain('t104');
  });
});
