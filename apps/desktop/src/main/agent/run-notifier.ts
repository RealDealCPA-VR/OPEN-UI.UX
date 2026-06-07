import { BrowserWindow, Notification } from 'electron';
import type { AgentRun } from '../../shared/agent-runs';
import { logger } from '../logger';
import { getAgentRunNotificationsEnabled } from '../storage/settings';
import { listRuns, onRunsChanged } from './run-registry';

let unsubscribe: (() => void) | null = null;
const lastStatus = new Map<string, AgentRun['status']>();

interface NotificationDescriptor {
  title: string;
  runId: string;
  task: string;
}

function isWorktreeReview(run: AgentRun): boolean {
  return run.worktreePath !== null && run.mergeStatus === 'pending';
}

function describeTransition(
  prev: AgentRun['status'],
  run: AgentRun,
): NotificationDescriptor | null {
  if (prev !== 'running') return null;
  if (run.status === 'completed') {
    if (isWorktreeReview(run)) {
      return { title: 'Worktree run ready to review', runId: run.id, task: run.task };
    }
    return { title: 'Agent run finished', runId: run.id, task: run.task };
  }
  if (run.status === 'failed') {
    return { title: 'Agent run failed', runId: run.id, task: run.task };
  }
  return null;
}

function anyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
}

function notify(desc: NotificationDescriptor): void {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: desc.title, body: desc.task.slice(0, 120), silent: false });
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('app:deep-link', `opencodex://agent/${desc.runId}`);
    });
    n.show();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), runId: desc.runId },
      'run-notifier: notification failed',
    );
  }
}

/**
 * Fires OS notifications when a user-spawned agent run transitions out of the
 * running state. Seeds the prior-status map from the current registry snapshot
 * before subscribing so runs hydrated at startup never notify. Idempotent.
 */
export function startRunNotifier(): void {
  if (unsubscribe !== null) return;
  for (const run of listRuns()) lastStatus.set(run.id, run.status);
  unsubscribe = onRunsChanged((runs) => {
    const seen = new Set<string>();
    for (const run of runs) {
      seen.add(run.id);
      const prev = lastStatus.get(run.id);
      lastStatus.set(run.id, run.status);
      if (prev === undefined || prev === run.status) continue;
      if (run.triggerSource !== 'user') continue;
      if (!getAgentRunNotificationsEnabled()) continue;
      if (anyWindowFocused()) continue;
      const desc = describeTransition(prev, run);
      if (desc) notify(desc);
    }
    for (const id of [...lastStatus.keys()]) {
      if (!seen.has(id)) lastStatus.delete(id);
    }
  });
}

export function stopRunNotifier(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  lastStatus.clear();
}

/** Test-only: seed the prior-status map exactly as startup would. */
export function __seedForTests(runs: readonly AgentRun[]): void {
  for (const run of runs) lastStatus.set(run.id, run.status);
}

/** Test-only: drop all in-memory state + the active subscription. */
export function __resetForTests(): void {
  stopRunNotifier();
}
