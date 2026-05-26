import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests, listRuns as listAgentRuns } from '../agent/run-registry';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { fireScheduledTask } from './runner';
import { createTask, getRun, listRuns } from './store';
import type { SubagentResult } from '../agent/subagent';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  __resetForTests();
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
  __resetForTests();
});

function fakeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    text: 'done',
    toolEvents: [],
    inputTokens: 10,
    outputTokens: 5,
    stopReason: 'end_turn',
    iterations: 1,
    ...overrides,
  };
}

describe('fireScheduledTask', () => {
  it('persists a scheduled_task_run and a run-registry row on success', async () => {
    const task = createTask({
      name: 'nightly sync',
      trigger: { type: 'cron', expr: '0 3 * * *' },
      prompt: 'do the thing',
      providerId: 'openai',
      model: 'gpt-4o-mini',
      workspacePath: '/tmp/scheduler-test-non-git',
      useWorktree: false,
    });

    const runOverride = vi.fn(async () => fakeResult());
    const res = await fireScheduledTask(task, { runOverride });

    expect(res.status).toBe('completed');
    expect(res.agentRunId).toBeTruthy();
    expect(runOverride).toHaveBeenCalledTimes(1);

    const stored = getRun(res.runId);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('completed');
    expect(stored!.agentRunId).toBe(res.agentRunId);

    const agentRuns = listAgentRuns();
    expect(agentRuns).toHaveLength(1);
    const agentRun = agentRuns[0]!;
    expect(agentRun.id).toBe(res.agentRunId);
    expect(agentRun.triggerSource).toBe('scheduled');
    expect(agentRun.scheduledTaskId).toBe(task.id);
    expect(agentRun.status).toBe('completed');
  });

  it('records a failed status when the subagent stops with error', async () => {
    const task = createTask({
      name: 'fail-test',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/scheduler-test-non-git',
      useWorktree: false,
    });

    const res = await fireScheduledTask(task, {
      runOverride: async () => fakeResult({ stopReason: 'error', error: 'boom' }),
    });

    expect(res.status).toBe('failed');
    const stored = getRun(res.runId);
    expect(stored!.status).toBe('failed');
  });

  it('records failed status when allowed-tools short-circuit returns unauthorized_tool', async () => {
    const task = createTask({
      name: 'tool-gate',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/scheduler-test-non-git',
      useWorktree: false,
      allowedTools: ['read_file'],
    });

    const res = await fireScheduledTask(task, {
      runOverride: async () => fakeResult({ stopReason: 'unauthorized_tool', error: 'blocked' }),
    });

    expect(res.status).toBe('failed');
  });

  it('records was_catchup when fired by catch-up path', async () => {
    const task = createTask({
      name: 'a',
      trigger: { type: 'cron', expr: '0 9 * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/scheduler-test-non-git',
      useWorktree: false,
    });
    const res = await fireScheduledTask(task, {
      wasCatchup: true,
      runOverride: async () => fakeResult(),
    });
    const stored = getRun(res.runId);
    expect(stored!.wasCatchup).toBe(true);
  });

  it('lists multiple runs per task in newest-first order', async () => {
    const task = createTask({
      name: 'multi',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/scheduler-test-non-git',
      useWorktree: false,
    });
    await fireScheduledTask(task, { runOverride: async () => fakeResult() });
    await fireScheduledTask(task, { runOverride: async () => fakeResult() });
    await fireScheduledTask(task, { runOverride: async () => fakeResult() });
    const runs = listRuns({ taskId: task.id }).runs;
    expect(runs).toHaveLength(3);
  });
});

describe('fireScheduledTask + worktree fallback', () => {
  it('runs directly when workspace is not a git repo even with useWorktree=true', async () => {
    const task = createTask({
      name: 'not-a-repo',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/scheduler-test-non-git-also',
      useWorktree: true,
    });
    let receivedWorkspaceRoot = '';
    const res = await fireScheduledTask(task, {
      runOverride: async (args) => {
        receivedWorkspaceRoot = args.workspaceRoot;
        return fakeResult();
      },
    });
    expect(res.status).toBe('completed');
    // Falls back to the configured workspace path.
    expect(receivedWorkspaceRoot).toBe(task.workspacePath);
    const agentRuns = listAgentRuns();
    expect(agentRuns[0]!.worktreePath).toBeNull();
  });
});
