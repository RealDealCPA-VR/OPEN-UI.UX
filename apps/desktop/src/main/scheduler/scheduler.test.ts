import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import {
  __hasTimerForTests,
  __resetForTests,
  rescheduleNow,
  startScheduler,
  stopScheduler,
} from './scheduler';
import { createTask, setTaskRunBookkeeping } from './store';
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

    // Allow microtasks (runCatchup -> scheduleNext) to settle.
    await vi.runAllTimersAsync();

    expect(__hasTimerForTests()).toBe(true);
    // Fast-forward to scheduled time
    vi.advanceTimersByTime(60_500);
    await vi.runAllTimersAsync();

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
    await vi.runAllTimersAsync();

    // catch-up should have invoked fire exactly once with wasCatchup: true.
    const catchupCalls = fireMock.mock.calls.filter((c) => c[1]?.wasCatchup === true);
    expect(catchupCalls).toHaveLength(1);
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
    await vi.runAllTimersAsync();

    // Advance to first fire.
    vi.advanceTimersByTime(15_000);
    await Promise.resolve(); // let microtasks settle
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
