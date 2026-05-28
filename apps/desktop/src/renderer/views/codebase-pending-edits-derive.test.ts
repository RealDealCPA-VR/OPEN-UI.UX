import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';
import {
  annotationMapFromPending,
  pendingEditsFingerprint,
  runsWithPendingEdits,
} from './codebase-pending-edits-derive';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    task: 'task',
    providerId: 'p',
    modelId: 'm',
    runnerId: 'internal',
    status: 'completed',
    startedAt: 1,
    completedAt: 2,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    toolEvents: [],
    stopReason: 'end_turn',
    error: null,
    worktreePath: null,
    worktreeBranch: null,
    worktreeRepoRoot: null,
    mergeStatus: null,
    triggerSource: 'user',
    scheduledTaskId: null,
    ...overrides,
  };
}

describe('runsWithPendingEdits', () => {
  it('returns only completed runs with pending mergeStatus', () => {
    const runs = [
      makeRun({ id: 'a', status: 'running' }),
      makeRun({
        id: 'b',
        worktreePath: '/x',
        worktreeBranch: 'b',
        worktreeRepoRoot: '/r',
        mergeStatus: 'pending',
      }),
      makeRun({
        id: 'c',
        worktreePath: '/x',
        worktreeBranch: 'c',
        worktreeRepoRoot: '/r',
        mergeStatus: 'merged',
      }),
      makeRun({ id: 'd', mergeStatus: 'pending' }),
    ];
    const out = runsWithPendingEdits(runs);
    expect(out.map((r) => r.id)).toEqual(['b']);
  });
});

describe('annotationMapFromPending', () => {
  it('aggregates multiple entries for the same path with a count', () => {
    const out = annotationMapFromPending([
      { runId: 'r1', path: 'src/a.ts', branch: 'b' },
      { runId: 'r2', path: 'src/a.ts', branch: 'c' },
      { runId: 'r1', path: 'src/b.ts', branch: 'b' },
    ]);
    expect(out).toEqual({
      'src/a.ts': { status: 'pending', count: 2, runIds: ['r1', 'r2'] },
      'src/b.ts': { status: 'pending', count: 1, runIds: ['r1'] },
    });
  });

  it('does not duplicate the same runId in runIds', () => {
    const out = annotationMapFromPending([
      { runId: 'r1', path: 'src/a.ts', branch: 'b' },
      { runId: 'r1', path: 'src/a.ts', branch: 'b' },
    ]);
    expect(out['src/a.ts']?.runIds).toEqual(['r1']);
    expect(out['src/a.ts']?.count).toBe(2);
  });
  it('returns empty for empty input', () => {
    expect(annotationMapFromPending([])).toEqual({});
  });
});

describe('pendingEditsFingerprint', () => {
  it('changes when mergeStatus changes', () => {
    const base = makeRun({
      id: 'r1',
      worktreePath: '/x',
      worktreeBranch: 'b',
      worktreeRepoRoot: '/r',
      mergeStatus: 'pending',
    });
    const a = pendingEditsFingerprint([base]);
    const b = pendingEditsFingerprint([{ ...base, mergeStatus: 'merged' }]);
    expect(a).not.toBe(b);
  });
  it('ignores running runs and runs without worktree', () => {
    const r1 = makeRun({ id: 'r1', status: 'running' });
    const r2 = makeRun({ id: 'r2' });
    expect(pendingEditsFingerprint([r1, r2])).toBe('');
  });
  it('is stable under reordering', () => {
    const a = makeRun({
      id: 'a',
      worktreePath: '/x',
      mergeStatus: 'pending',
      completedAt: 100,
    });
    const b = makeRun({
      id: 'b',
      worktreePath: '/y',
      mergeStatus: 'pending',
      completedAt: 200,
    });
    expect(pendingEditsFingerprint([a, b])).toBe(pendingEditsFingerprint([b, a]));
  });
});
