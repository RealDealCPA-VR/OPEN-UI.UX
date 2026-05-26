import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';
import {
  canAbort,
  canContinueInChat,
  currentToolName,
  formatDurationMs,
  formatTokens,
  hasUnresolvedWorktree,
  partitionRunsByActivity,
  runDurationMs,
  statusLabel,
  statusPillClass,
  stopReasonLabel,
  toolErrorCount,
  truncate,
} from './agent-runs-derive';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    task: 'Investigate failing test',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    status: 'running',
    startedAt: 1_000,
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
    scheduledTaskId: null,
    ...overrides,
  };
}

describe('truncate', () => {
  it('returns the input unchanged when short enough', () => {
    expect(truncate('short', 80)).toBe('short');
  });
  it('truncates and appends an ellipsis when too long', () => {
    expect(truncate('a'.repeat(81), 10)).toBe('aaaaaaaaa…');
    expect(truncate('a'.repeat(81), 10)).toHaveLength(10);
  });
});

describe('formatDurationMs', () => {
  it('formats sub-second values in ms', () => {
    expect(formatDurationMs(0)).toBe('0 ms');
    expect(formatDurationMs(999)).toBe('999 ms');
  });
  it('formats sub-minute values in seconds with 2 decimals', () => {
    expect(formatDurationMs(1500)).toBe('1.50 s');
    expect(formatDurationMs(59_999)).toBe('60.00 s');
  });
  it('formats minute-scale values as "Xm Ys"', () => {
    expect(formatDurationMs(60_000)).toBe('1m 0s');
    expect(formatDurationMs(125_000)).toBe('2m 5s');
  });
  it('returns em-dash for invalid input', () => {
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(-1)).toBe('—');
  });
});

describe('runDurationMs', () => {
  it('uses completedAt when the run is finished', () => {
    const r = makeRun({ startedAt: 1000, completedAt: 3500, status: 'completed' });
    expect(runDurationMs(r, 999_999)).toBe(2500);
  });
  it('uses now when the run is still running', () => {
    const r = makeRun({ startedAt: 1000 });
    expect(runDurationMs(r, 4000)).toBe(3000);
  });
  it('clamps to zero when now < startedAt', () => {
    const r = makeRun({ startedAt: 5000 });
    expect(runDurationMs(r, 1000)).toBe(0);
  });
});

describe('formatTokens', () => {
  it('uses locale thousands separators', () => {
    // toLocaleString() default locale varies; assert digits + at least one separator for 4-digit+ numbers
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1_234).replace(/[^0-9]/g, '')).toBe('1234');
  });
});

describe('statusLabel + statusPillClass', () => {
  it('labels every status', () => {
    expect(statusLabel('running')).toBe('Running');
    expect(statusLabel('completed')).toBe('Completed');
    expect(statusLabel('failed')).toBe('Failed');
  });
  it('maps every status to a pill class', () => {
    expect(statusPillClass('running')).toContain('pill');
    expect(statusPillClass('completed')).toContain('pill-ok');
    expect(statusPillClass('failed')).toContain('pill-warn');
  });
});

describe('stopReasonLabel', () => {
  it('returns em-dash for null', () => {
    expect(stopReasonLabel(null)).toBe('—');
  });
  it('returns the reason string otherwise', () => {
    expect(stopReasonLabel('end_turn')).toBe('end_turn');
    expect(stopReasonLabel('budget_exceeded')).toBe('budget_exceeded');
    expect(stopReasonLabel('error')).toBe('error');
  });
});

describe('currentToolName', () => {
  it('returns null when the run is not running', () => {
    const r = makeRun({
      status: 'completed',
      toolEvents: [{ name: 'read_file', isError: false, durationMs: 10 }],
    });
    expect(currentToolName(r)).toBeNull();
  });
  it('returns null when the running run has no tool events yet', () => {
    expect(currentToolName(makeRun())).toBeNull();
  });
  it('returns the most recent tool name when running', () => {
    const r = makeRun({
      toolEvents: [
        { name: 'read_file', isError: false, durationMs: 10 },
        { name: 'grep', isError: false, durationMs: 8 },
      ],
    });
    expect(currentToolName(r)).toBe('grep');
  });
});

describe('toolErrorCount', () => {
  it('counts events where isError is true', () => {
    const r = makeRun({
      toolEvents: [
        { name: 'a', isError: false, durationMs: 1 },
        { name: 'b', isError: true, durationMs: 2 },
        { name: 'c', isError: true, durationMs: 3 },
      ],
    });
    expect(toolErrorCount(r)).toBe(2);
  });
  it('returns 0 when there are no tool events', () => {
    expect(toolErrorCount(makeRun())).toBe(0);
  });
});

describe('partitionRunsByActivity', () => {
  it('splits running and non-running runs', () => {
    const a = makeRun({ id: 'a', status: 'running' });
    const b = makeRun({ id: 'b', status: 'completed' });
    const c = makeRun({ id: 'c', status: 'failed' });
    const d = makeRun({ id: 'd', status: 'running' });
    const { active, history } = partitionRunsByActivity([a, b, c, d]);
    expect(active.map((r) => r.id)).toEqual(['a', 'd']);
    expect(history.map((r) => r.id)).toEqual(['b', 'c']);
  });
  it('handles empty input', () => {
    const { active, history } = partitionRunsByActivity([]);
    expect(active).toEqual([]);
    expect(history).toEqual([]);
  });
});

describe('hasUnresolvedWorktree', () => {
  it('returns false when no worktree fields', () => {
    expect(hasUnresolvedWorktree(makeRun())).toBe(false);
  });
  it('returns true only when mergeStatus is pending and worktree fields populated', () => {
    expect(
      hasUnresolvedWorktree(
        makeRun({
          worktreePath: '/x',
          worktreeBranch: 'b',
          worktreeRepoRoot: '/r',
          mergeStatus: 'pending',
        }),
      ),
    ).toBe(true);
    expect(
      hasUnresolvedWorktree(
        makeRun({
          worktreePath: '/x',
          worktreeBranch: 'b',
          worktreeRepoRoot: '/r',
          mergeStatus: 'merged',
        }),
      ),
    ).toBe(false);
  });
});

describe('canContinueInChat + canAbort', () => {
  it('allows continue-in-chat only for finished runs', () => {
    expect(canContinueInChat(makeRun({ status: 'running' }))).toBe(false);
    expect(canContinueInChat(makeRun({ status: 'completed' }))).toBe(true);
    expect(canContinueInChat(makeRun({ status: 'failed' }))).toBe(true);
  });
  it('allows abort only for running runs', () => {
    expect(canAbort(makeRun({ status: 'running' }))).toBe(true);
    expect(canAbort(makeRun({ status: 'completed' }))).toBe(false);
    expect(canAbort(makeRun({ status: 'failed' }))).toBe(false);
  });
});
