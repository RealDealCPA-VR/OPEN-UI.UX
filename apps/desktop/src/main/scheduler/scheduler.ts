import cronParser from 'cron-parser';
import { logger } from '../logger';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { FileChangeWatcherRegistry } from './file-watcher';
import { fireScheduledTask } from './runner';
import { getTask, listTasks as listTasksFromStore, setTaskRunBookkeeping } from './store';

type TaskListProvider = () => readonly ScheduledTask[];
type Notifier = (event: {
  taskId: string;
  agentRunId: string;
  status: 'completed' | 'failed';
}) => void;

export interface SchedulerOptions {
  listTasks?: TaskListProvider;
  fire?: typeof fireScheduledTask;
  onRunCompleted?: Notifier;
}

const MAX_SETTIMEOUT_MS = 2_147_483_647;

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let listTasksImpl: TaskListProvider = () => listTasksFromStore();
let fireImpl: typeof fireScheduledTask = fireScheduledTask;
let notifyImpl: Notifier = () => undefined;
const runningTasks = new Set<string>();
const fileWatcherRegistry = new FileChangeWatcherRegistry();

/**
 * Compute the next-fire UTC date for a task's trigger.
 *
 * Returns null for event-driven triggers (manual / file-change / git-hook /
 * webhook) — those have no scheduled tick. Cron uses cron-parser.
 */
export function computeNextFire(task: ScheduledTask, after: Date = new Date()): Date | null {
  switch (task.trigger.type) {
    case 'manual':
    case 'file-change':
    case 'git-hook':
    case 'webhook':
      return null;
    case 'cron': {
      const it = cronParser.parseExpression(task.trigger.expr, {
        currentDate: after,
        tz: 'UTC',
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
export function validateCronExpression(expr: string): void {
  cronParser.parseExpression(expr);
}

interface NextFire {
  task: ScheduledTask;
  whenMs: number;
}

function pickNextDueTask(now: Date = new Date()): NextFire | null {
  const tasks = listTasksImpl().filter((t) => t.enabled && t.trigger.type === 'cron');
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

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext(): void {
  if (!running) return;
  clearTimer();
  const now = new Date();
  const due = pickNextDueTask(now);
  if (!due) {
    // No tasks; nothing to schedule. We'll re-evaluate when tasks change.
    return;
  }
  const delay = Math.max(0, Math.min(due.whenMs - now.getTime(), MAX_SETTIMEOUT_MS));
  // Persist next_run_at on every reschedule so the UI sees a fresh ETA.
  setTaskRunBookkeeping(due.task.id, {
    nextRunAt: new Date(due.whenMs).toISOString().slice(0, 19).replace('T', ' '),
  });
  timer = setTimeout(() => {
    timer = null;
    void tick(due.task.id);
  }, delay);
}

async function tick(taskId: string): Promise<void> {
  if (!running) return;
  // Re-fetch in case the task changed since we scheduled.
  const fresh = getTask(taskId);
  if (!fresh || !fresh.enabled) {
    scheduleNext();
    return;
  }
  if (runningTasks.has(taskId)) {
    logger.info(
      { taskId },
      'scheduler: tick fired while task already running; skipping and advancing',
    );
    scheduleNext();
    return;
  }
  runningTasks.add(taskId);
  try {
    const res = await fireImpl(fresh);
    notifyImpl({ taskId, agentRunId: res.agentRunId, status: res.status });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), taskId },
      'scheduler: fireScheduledTask threw',
    );
  } finally {
    runningTasks.delete(taskId);
    scheduleNext();
  }
}

export function startScheduler(opts: SchedulerOptions = {}): void {
  if (running) return;
  running = true;
  if (opts.listTasks) listTasksImpl = opts.listTasks;
  if (opts.fire) fireImpl = opts.fire;
  if (opts.onRunCompleted) notifyImpl = opts.onRunCompleted;
  logger.info('scheduler started');
  void runCatchup()
    .then(() => scheduleNext())
    .then(() => void reconcileFileWatchers());
}

export function stopScheduler(): void {
  running = false;
  clearTimer();
  runningTasks.clear();
  void fileWatcherRegistry.stopAll();
  logger.info('scheduler stopped');
}

export function rescheduleNow(): void {
  if (!running) return;
  scheduleNext();
  void reconcileFileWatchers();
}

/**
 * Fire a task by id, regardless of trigger type. Used by event-driven
 * triggers (file-change, git-hook, webhook). Honors the concurrent-run guard.
 */
export async function fireTaskById(taskId: string): Promise<void> {
  if (!running) return;
  if (runningTasks.has(taskId)) {
    logger.info({ taskId }, 'scheduler: fireTaskById skipped (already running)');
    return;
  }
  const fresh = getTask(taskId);
  if (!fresh || !fresh.enabled) return;
  runningTasks.add(taskId);
  try {
    const res = await fireImpl(fresh);
    notifyImpl({ taskId, agentRunId: res.agentRunId, status: res.status });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), taskId },
      'scheduler: fireTaskById threw',
    );
  } finally {
    runningTasks.delete(taskId);
  }
}

async function reconcileFileWatchers(): Promise<void> {
  if (!running) return;
  const desired = listTasksImpl()
    .filter((t) => t.enabled && t.trigger.type === 'file-change')
    .map((t) => ({
      taskId: t.id,
      workspaceRoot: t.workspacePath,
      glob: t.trigger.type === 'file-change' ? t.trigger.glob : '',
    }))
    .filter((d) => d.glob.length > 0 && d.workspaceRoot.length > 0);
  try {
    await fileWatcherRegistry.reconcile(desired, (id) => fireTaskById(id));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'scheduler: file-watcher reconcile failed',
    );
  }
}

/**
 * Catch-up policy: for each enabled cron task whose next_run_at is in the
 * past, fire ONCE with was_catchup: true. Do NOT replay every missed run.
 */
async function runCatchup(): Promise<void> {
  const now = new Date();
  for (const task of listTasksImpl()) {
    if (!task.enabled || task.trigger.type !== 'cron') continue;
    if (!task.nextRunAt) continue;
    // task.nextRunAt is stored as ISO-ish without TZ; treat as UTC.
    const next = parseStoredTs(task.nextRunAt);
    if (!next || next.getTime() > now.getTime()) continue;
    if (runningTasks.has(task.id)) continue;
    runningTasks.add(task.id);
    void (async () => {
      try {
        const fresh = getTask(task.id);
        if (!fresh) return;
        const res = await fireImpl(fresh, { wasCatchup: true });
        notifyImpl({ taskId: task.id, agentRunId: res.agentRunId, status: res.status });
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), taskId: task.id },
          'scheduler: catch-up fire failed',
        );
      } finally {
        runningTasks.delete(task.id);
        scheduleNext();
      }
    })();
  }
}

function parseStoredTs(raw: string): Date | null {
  // Accept both "YYYY-MM-DD HH:MM:SS" (SQLite CURRENT_TIMESTAMP) and ISO 8601.
  const cleaned = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Test-only helpers
export function __resetForTests(): void {
  running = false;
  clearTimer();
  runningTasks.clear();
  void fileWatcherRegistry.stopAll();
  listTasksImpl = () => listTasksFromStore();
  fireImpl = fireScheduledTask;
  notifyImpl = () => undefined;
}

export function __isRunningForTests(): boolean {
  return running;
}

export function __hasTimerForTests(): boolean {
  return timer !== null;
}
