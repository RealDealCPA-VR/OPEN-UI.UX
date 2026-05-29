import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import {
  __hasTimerForTests,
  __resetForTests,
  computeNextFire,
  getSchedulerFireLog,
  rescheduleNow,
  setSchedulerMaxConcurrentRunsPerTask,
  startScheduler,
  stopScheduler,
} from './scheduler';
import { createTask, setTaskRunBookkeeping, getTask } from './store';
import type { ScheduledTask } from '../../shared/scheduled-tasks';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  setDbForTesting(null);
  db.close();
  vi.useRealTimers();
});

function makeCronTask(expr: string, enabled = true): ScheduledTask {
  return createTask({
    name: `t-${Math.random().toString(36).slice(2, 8)}`,
    trigger: { type: 'cron', expr },
    prompt: 'p',
    providerId: 'openai',
    model: 'm',
    workspacePath: '/tmp/ws',
    enabled,
  });
}

describe('scheduler runtime', () => {
  it('fires the next-due task and re-schedules', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-05-26T07:59:00Z');
    vi.setSystemTime(baseTime);
    const fired: string[] = [];
    const task = makeCronTask('0 8 * * *'); // every day at 08:00 UTC

    startScheduler({
      fire: vi.fn(async (t) => {
        fired.push(t.id);
        return { runId: 'r', agentRunId: 'a', status: 'completed' as const };
      }),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(__hasTimerForTests()).toBe(true);
    // Fast-forward to scheduled time, then stop the scheduler to break the
    // self-rearming chain before runAllTimersAsync spins.
    vi.advanceTimersByTime(60_500);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    stopScheduler();

    expect(fired).toContain(task.id);
  });

  it('skips a tick when the task is disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T07:59:00Z'));
    const fired: string[] = [];
    const t = makeCronTask('0 8 * * *', false);

    startScheduler({
      fire: vi.fn(async (task) => {
        fired.push(task.id);
        return { runId: 'r', agentRunId: 'a', status: 'completed' as const };
      }),
    });

    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(120_000);
    await vi.runAllTimersAsync();

    expect(fired).not.toContain(t.id);
  });

  it('catch-up: fires once if next_run_at is in the past', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T10:00:00Z'));
    const t = makeCronTask('0 9 * * *');
    // Put nextRunAt in the past.
    setTaskRunBookkeeping(t.id, { nextRunAt: '2026-05-26 08:00:00' });

    const fireMock = vi.fn(async (_task: ScheduledTask, opts?: { wasCatchup?: boolean }) => ({
      runId: 'r',
      agentRunId: 'a',
      status: 'completed' as const,
      _opts: opts,
    }));
    startScheduler({ fire: fireMock });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    stopScheduler();

    // catch-up should have invoked fire exactly once with wasCatchup: true.
    const catchupCalls = fireMock.mock.calls.filter((c) => c[1]?.wasCatchup === true);
    expect(catchupCalls).toHaveLength(1);
    void t;
  });

  it('computeNextFire honors the cron trigger tz field', () => {
    const t = createTask({
      name: 'tz-test',
      trigger: { type: 'cron', expr: '0 9 * * *', tz: 'America/Los_Angeles' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
    });
    const after = new Date('2026-05-26T08:00:00Z');
    const next = computeNextFire(t, after);
    expect(next).not.toBeNull();
    // 09:00 America/Los_Angeles on 2026-05-26 is 16:00 UTC (PDT = UTC-7).
    expect(next!.toISOString()).toBe('2026-05-26T16:00:00.000Z');
  });

  it('runCatchup resets next_run_at to a future tick after firing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T10:00:00Z'));
    const t = createTask({
      name: 'catchup-reset',
      trigger: { type: 'cron', expr: '0 9 * * *' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
    });
    setTaskRunBookkeeping(t.id, { nextRunAt: '2026-05-26 08:00:00' });

    const fireMock = vi.fn(async () => ({
      runId: 'r',
      agentRunId: 'a',
      status: 'completed' as const,
    }));
    startScheduler({ fire: fireMock });
    // Let the runCatchup + its async finally settle without spinning the timer chain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    stopScheduler();

    const refreshed = getTask(t.id);
    expect(refreshed).not.toBeNull();
    expect(refreshed!.nextRunAt).not.toBeNull();
    expect(refreshed!.nextRunAt).not.toBe('2026-05-26 08:00:00');
  });

  it('records a fire-log entry on every fire (via fireTaskById)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T07:59:00Z'));
    const t = createTask({
      name: 'logged',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
    });
    startScheduler({
      fire: vi.fn(async () => ({
        runId: 'r',
        agentRunId: 'a',
        status: 'completed' as const,
      })),
    });
    await Promise.resolve();
    await Promise.resolve();
    await import('./scheduler').then((m) => m.fireTaskById(t.id));
    await Promise.resolve();
    const log = getSchedulerFireLog();
    expect(log.some((entry) => entry.taskId === t.id)).toBe(true);
    stopScheduler();
  });

  it('caps concurrent in-flight runs per task', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T07:59:50Z'));
    setSchedulerMaxConcurrentRunsPerTask(1);
    const t = createTask({
      name: 'manual-cap',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
    });
    let inFlight = 0;
    let peak = 0;
    let releaseFire: (() => void) | null = null;
    const fire = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => {
        releaseFire = resolve;
      });
      inFlight -= 1;
      return { runId: 'r', agentRunId: 'a', status: 'completed' as const };
    });
    startScheduler({ fire });
    const mod = await import('./scheduler');
    await Promise.resolve();
    void mod.fireTaskById(t.id);
    void mod.fireTaskById(t.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(1);
    if (releaseFire) (releaseFire as () => void)();
    stopScheduler();
  });

  it('concurrent-run guard: a second tick during a run is skipped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T07:59:50Z'));
    const t = makeCronTask('* * * * *'); // every minute

    let resolveFire: (() => void) | null = null;
    const blockingFire = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveFire = resolve;
      });
      return { runId: 'r', agentRunId: 'a', status: 'completed' as const };
    });

    startScheduler({ fire: blockingFire });
    await Promise.resolve();
    await Promise.resolve();

    // Advance to first fire.
    vi.advanceTimersByTime(15_000);
    await Promise.resolve(); // let microtasks settle
    await Promise.resolve();
    expect(blockingFire).toHaveBeenCalledTimes(1);

    // While the first call is pending, force a re-evaluation
    // (this re-schedules but should NOT enter a second fire because runningTasks
    // already contains this task id when the next tick lands).
    rescheduleNow();
    vi.advanceTimersByTime(120_000);
    await Promise.resolve();

    // Still only one in-flight call.
    expect(blockingFire).toHaveBeenCalledTimes(1);

    // Now release the first call so the scheduler can continue cleanly.
    if (resolveFire) (resolveFire as () => void)();
    await vi.runAllTimersAsync();
    // After completion, runningTasks is cleared and a follow-up tick may fire.
    expect(blockingFire.mock.calls.length).toBeGreaterThanOrEqual(1);
    stopScheduler();
    void t;
  });
});
