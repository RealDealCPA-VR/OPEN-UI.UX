import cronParser from 'cron-parser';
import { logger } from '../logger';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { track } from '../telemetry/manager';
import { FileChangeWatcherRegistry } from './file-watcher';
import { fireScheduledTask } from './runner';
import { getTask, listTasks as listTasksFromStore, setTaskRunBookkeeping } from './store';
import { withSqliteBusyRetry } from '../util/sqlite-retry';

type TaskListProvider = () => readonly ScheduledTask[];
type Notifier = (event: {
  taskId: string;
  runId: string;
  agentRunId: string;
  status: 'completed' | 'failed';
}) => void;

export interface SchedulerOptions {
  listTasks?: TaskListProvider;
  fire?: typeof fireScheduledTask;
  onRunCompleted?: Notifier;
}

const MAX_SETTIMEOUT_MS = 2_147_483_647;
export const DEFAULT_MAX_CONCURRENT_RUNS_PER_TASK = 1;
const SLEEP_DRIFT_DETECTION_MS = 90_000;

interface FireLogEntry {
  taskId: string;
  firedAt: string;
  reason: 'tick' | 'catchup' | 'manual';
}

const fireLog: FireLogEntry[] = [];
const FIRE_LOG_MAX_ENTRIES = 1_000;

function recordFireLog(entry: FireLogEntry): void {
  fireLog.push(entry);
  if (fireLog.length > FIRE_LOG_MAX_ENTRIES) {
    fireLog.splice(0, fireLog.length - FIRE_LOG_MAX_ENTRIES);
  }
}

/**
 * Compute the next-fire UTC date for a task's trigger.
 *
 * Returns null for event-driven triggers (manual / file-change / git-hook /
 * webhook) — those have no scheduled tick. Cron uses cron-parser. Honors an
 * optional `tz` (IANA timezone) on the cron trigger.
 */
export function computeNextFire(
  task: ScheduledTask,
  after: Date = new Date(),
  tzOverride?: string,
): Date | null {
  switch (task.trigger.type) {
    case 'manual':
    case 'file-change':
    case 'git-hook':
    case 'webhook':
      return null;
    case 'cron': {
      const tz = tzOverride ?? task.trigger.tz ?? 'UTC';
      const it = cronParser.parseExpression(task.trigger.expr, {
        currentDate: after,
        tz,
      });
      return it.next().toDate();
    }
    default: {
      const _exhaustive: never = task.trigger;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Validate a cron expression. Throws with a descriptive message if invalid.
 * Use at task-create/update time so bad expressions don't reach the tick loop.
 */
export function validateCronExpression(expr: string, tz?: string): void {
  cronParser.parseExpression(expr, tz ? { tz } : undefined);
}

interface NextFire {
  task: ScheduledTask;
  whenMs: number;
}

class Scheduler {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listTasksImpl: TaskListProvider = () => listTasksFromStore();
  private fireImpl: typeof fireScheduledTask = fireScheduledTask;
  private notifyImpl: Notifier = () => undefined;
  private readonly runningCounts = new Map<string, number>();
  private readonly fileWatcherRegistry = new FileChangeWatcherRegistry();
  private readonly skipLogSeen = new Set<string>();
  private maxConcurrentRunsPerTask = DEFAULT_MAX_CONCURRENT_RUNS_PER_TASK;
  private lastTickWallClockMs: number | null = null;
  private lastTickPerfMs: number | null = null;

  isRunning(): boolean {
    return this.running;
  }

  hasTimer(): boolean {
    return this.timer !== null;
  }

  private logSkipOnce(taskId: string, reason: string, message: string): void {
    const key = `${taskId}::${reason}`;
    if (this.skipLogSeen.has(key)) return;
    this.skipLogSeen.add(key);
    logger.info({ taskId, reason }, message);
  }

  private pickNextDueTask(now: Date = new Date()): NextFire | null {
    const tasks = this.listTasksImpl().filter((t) => t.enabled && t.trigger.type === 'cron');
    let best: NextFire | null = null;
    for (const task of tasks) {
      try {
        const next = computeNextFire(task, now);
        if (!next) continue;
        const whenMs = next.getTime();
        if (best === null || whenMs < best.whenMs) {
          best = { task, whenMs };
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), taskId: task.id },
          'scheduler: computeNextFire failed; skipping task',
        );
      }
    }
    return best;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private armTimer(delayMs: number, onFire: () => void): void {
    if (delayMs <= MAX_SETTIMEOUT_MS) {
      this.timer = setTimeout(onFire, delayMs);
      return;
    }
    // setTimeout caps at ~24.85 days. Chain a half-hop and re-arm on landing.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armTimer(delayMs - MAX_SETTIMEOUT_MS, onFire);
    }, MAX_SETTIMEOUT_MS);
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.clearTimer();
    const now = new Date();
    this.detectMissedSlots(now);
    const due = this.pickNextDueTask(now);
    if (!due) {
      this.lastTickWallClockMs = now.getTime();
      return;
    }
    const delay = Math.max(0, due.whenMs - now.getTime());
    try {
      withSqliteBusyRetry(() =>
        setTaskRunBookkeeping(due.task.id, {
          nextRunAt: new Date(due.whenMs).toISOString().slice(0, 19).replace('T', ' '),
        }),
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), taskId: due.task.id },
        'scheduler: setTaskRunBookkeeping failed; continuing',
      );
    }
    this.lastTickWallClockMs = now.getTime();
    this.lastTickPerfMs = performance.now();
    this.armTimer(delay, () => {
      this.timer = null;
      void this.tick(due.task.id);
    });
  }

  private detectMissedSlots(now: Date): void {
    if (this.lastTickWallClockMs === null || this.lastTickPerfMs === null) return;
    const wallGap = now.getTime() - this.lastTickWallClockMs;
    const perfGap = performance.now() - this.lastTickPerfMs;
    // A real sleep/wake gap has BOTH wall-clock and perf elapse together. If
    // only wall-clock jumped (e.g. fake timers in tests), this is not a sleep.
    if (wallGap <= SLEEP_DRIFT_DETECTION_MS) return;
    if (perfGap <= SLEEP_DRIFT_DETECTION_MS) return;
    let missed = 0;
    for (const task of this.listTasksImpl()) {
      if (!task.enabled || task.trigger.type !== 'cron') continue;
      try {
        const it = cronParser.parseExpression(task.trigger.expr, {
          currentDate: new Date(this.lastTickWallClockMs),
          endDate: now,
          tz: task.trigger.tz ?? 'UTC',
        });
        while (true) {
          try {
            it.next();
            missed += 1;
          } catch {
            break;
          }
        }
      } catch {
        // Bad cron / unable to enumerate — ignore for missed-slot counting.
      }
    }
    if (missed > 0) {
      try {
        track('scheduler.missed_slots', { count: missed, gapMs: wallGap });
      } catch {
        // telemetry is best-effort
      }
      logger.info({ missed, gapMs: wallGap }, 'scheduler: detected missed slots after sleep/wake');
    }
  }

  private runningCount(taskId: string): number {
    return this.runningCounts.get(taskId) ?? 0;
  }

  private incRunning(taskId: string): void {
    this.runningCounts.set(taskId, this.runningCount(taskId) + 1);
  }

  private decRunning(taskId: string): void {
    const cur = this.runningCount(taskId);
    if (cur <= 1) this.runningCounts.delete(taskId);
    else this.runningCounts.set(taskId, cur - 1);
  }

  private async tick(taskId: string): Promise<void> {
    if (!this.running) return;
    const fresh = getTask(taskId);
    if (!fresh || !fresh.enabled) {
      this.scheduleNext();
      return;
    }
    if (this.runningCount(taskId) >= this.maxConcurrentRunsPerTask) {
      this.logSkipOnce(
        taskId,
        'concurrent-run',
        'scheduler: tick fired while task at concurrency cap; skipping and advancing',
      );
      this.scheduleNext();
      return;
    }
    this.incRunning(taskId);
    this.skipLogSeen.delete(`${taskId}::concurrent-run`);
    recordFireLog({ taskId, firedAt: new Date().toISOString(), reason: 'tick' });
    try {
      const res = await this.fireImpl(fresh);
      this.notifyImpl({ taskId, runId: res.runId, agentRunId: res.agentRunId, status: res.status });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), taskId },
        'scheduler: fireScheduledTask threw',
      );
    } finally {
      this.decRunning(taskId);
      this.scheduleNext();
    }
  }

  start(opts: SchedulerOptions = {}): void {
    if (this.running) return;
    this.running = true;
    if (opts.listTasks) this.listTasksImpl = opts.listTasks;
    if (opts.fire) this.fireImpl = opts.fire;
    if (opts.onRunCompleted) this.notifyImpl = opts.onRunCompleted;
    logger.info('scheduler started');
    void this.runCatchup()
      .then(() => this.scheduleNext())
      .then(() => void this.reconcileFileWatchers());
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.runningCounts.clear();
    void this.fileWatcherRegistry.stopAll();
    logger.info('scheduler stopped');
  }

  rescheduleNow(): void {
    if (!this.running) return;
    this.scheduleNext();
    void this.reconcileFileWatchers();
  }

  /**
   * Fire a task by id, regardless of trigger type. Used by event-driven
   * triggers (file-change, git-hook, webhook). Honors the concurrency cap.
   */
  async fireTaskById(taskId: string): Promise<void> {
    if (!this.running) return;
    if (this.runningCount(taskId) >= this.maxConcurrentRunsPerTask) {
      this.logSkipOnce(
        taskId,
        'fire-by-id-busy',
        'scheduler: fireTaskById skipped (at concurrency cap)',
      );
      return;
    }
    this.skipLogSeen.delete(`${taskId}::fire-by-id-busy`);
    const fresh = getTask(taskId);
    if (!fresh || !fresh.enabled) return;
    this.incRunning(taskId);
    recordFireLog({ taskId, firedAt: new Date().toISOString(), reason: 'manual' });
    try {
      const res = await this.fireImpl(fresh);
      this.notifyImpl({ taskId, runId: res.runId, agentRunId: res.agentRunId, status: res.status });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), taskId },
        'scheduler: fireTaskById threw',
      );
    } finally {
      this.decRunning(taskId);
    }
  }

  private async reconcileFileWatchers(): Promise<void> {
    if (!this.running) return;
    const desired = this.listTasksImpl()
      .filter((t) => t.enabled && t.trigger.type === 'file-change')
      .map((t) => ({
        taskId: t.id,
        workspaceRoot: t.workspacePath,
        glob: t.trigger.type === 'file-change' ? t.trigger.glob : '',
      }))
      .filter((d) => d.glob.length > 0 && d.workspaceRoot.length > 0);
    try {
      await this.fileWatcherRegistry.reconcile(desired, (id) => this.fireTaskById(id));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'scheduler: file-watcher reconcile failed',
      );
    }
  }

  /**
   * Catch-up policy: for each enabled cron task whose next_run_at is in the
   * past, fire ONCE with was_catchup: true. After the fire completes, reset
   * next_run_at to the next scheduled tick so the UI / next start doesn't
   * keep showing a stale "due in the past" timestamp.
   */
  private async runCatchup(): Promise<void> {
    const now = new Date();
    for (const task of this.listTasksImpl()) {
      if (!task.enabled || task.trigger.type !== 'cron') continue;
      if (!task.nextRunAt) continue;
      const next = parseStoredTs(task.nextRunAt);
      if (!next || next.getTime() > now.getTime()) continue;
      if (this.runningCount(task.id) >= this.maxConcurrentRunsPerTask) {
        this.logSkipOnce(
          task.id,
          'catchup-busy',
          'scheduler: catch-up skipped (at concurrency cap)',
        );
        continue;
      }
      this.incRunning(task.id);
      void (async (): Promise<void> => {
        try {
          const fresh = getTask(task.id);
          if (!fresh) return;
          recordFireLog({ taskId: task.id, firedAt: new Date().toISOString(), reason: 'catchup' });
          const res = await this.fireImpl(fresh, { wasCatchup: true });
          this.notifyImpl({
            taskId: task.id,
            runId: res.runId,
            agentRunId: res.agentRunId,
            status: res.status,
          });
          try {
            const refreshed = getTask(task.id);
            if (refreshed) {
              const after = computeNextFire(refreshed, new Date());
              if (after) {
                withSqliteBusyRetry(() =>
                  setTaskRunBookkeeping(task.id, {
                    nextRunAt: new Date(after.getTime())
                      .toISOString()
                      .slice(0, 19)
                      .replace('T', ' '),
                  }),
                );
              }
            }
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), taskId: task.id },
              'scheduler: catch-up post-reset of next_run_at failed',
            );
          }
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err), taskId: task.id },
            'scheduler: catch-up fire failed',
          );
        } finally {
          this.decRunning(task.id);
          this.scheduleNext();
        }
      })();
    }
  }

  setMaxConcurrentRunsPerTask(n: number): void {
    if (n < 1) throw new Error('maxConcurrentRunsPerTask must be >= 1');
    this.maxConcurrentRunsPerTask = n;
  }

  getMaxConcurrentRunsPerTask(): number {
    return this.maxConcurrentRunsPerTask;
  }

  resetForTests(): void {
    this.running = false;
    this.clearTimer();
    this.runningCounts.clear();
    this.skipLogSeen.clear();
    this.lastTickWallClockMs = null;
    this.lastTickPerfMs = null;
    this.maxConcurrentRunsPerTask = DEFAULT_MAX_CONCURRENT_RUNS_PER_TASK;
    void this.fileWatcherRegistry.stopAll();
    this.listTasksImpl = () => listTasksFromStore();
    this.fireImpl = fireScheduledTask;
    this.notifyImpl = () => undefined;
  }
}

const scheduler = new Scheduler();

export function startScheduler(opts: SchedulerOptions = {}): void {
  scheduler.start(opts);
}

export function stopScheduler(): void {
  scheduler.stop();
}

export function rescheduleNow(): void {
  scheduler.rescheduleNow();
}

export async function fireTaskById(taskId: string): Promise<void> {
  return scheduler.fireTaskById(taskId);
}

export function setSchedulerMaxConcurrentRunsPerTask(n: number): void {
  scheduler.setMaxConcurrentRunsPerTask(n);
}

export function getSchedulerFireLog(): readonly FireLogEntry[] {
  return fireLog.slice();
}

function parseStoredTs(raw: string): Date | null {
  const cleaned = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Test-only helpers
export function __resetForTests(): void {
  scheduler.resetForTests();
  fireLog.splice(0, fireLog.length);
}

export function __isRunningForTests(): boolean {
  return scheduler.isRunning();
}

export function __hasTimerForTests(): boolean {
  return scheduler.hasTimer();
}
