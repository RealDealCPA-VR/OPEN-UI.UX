import { logger } from '../logger';
import { getSchedulerListenerPort, setSchedulerListenerPort } from '../storage/settings';
import { fireTaskById } from './scheduler';
import {
  installGitHook,
  uninstallGitHook,
  writeListenerPortFile,
  type GitHookName,
} from './git-hooks';
import {
  buildTriggerUrl,
  getListenerPort,
  startListener,
  stopListener,
  type TaskSecretLookup,
} from './listener';
import { getTask, listTasks } from './store';

/**
 * Glue between the trigger types and the runtime infrastructure.
 *
 * - Starts the local HTTP listener once on app boot (port persisted to settings).
 * - Looks up per-task secrets for inbound webhook + git-hook callbacks.
 * - Installs / uninstalls hook scripts when git-hook tasks come and go.
 *
 * The scheduler proper owns the file-change watchers; this module owns the
 * listener and the on-disk git hooks. They share `fireTaskById` from
 * scheduler.ts.
 */

let listenerStarted = false;

/**
 * Returns the per-task secret + trigger kind for an inbound HTTP callback.
 * Lookups go through the live store, so newly created tasks become callable
 * immediately and deleted tasks return null.
 */
function lookupTaskSecret(taskId: string): { kind: 'webhook' | 'git-hook'; secret: string } | null {
  const task = getTask(taskId);
  if (!task || !task.enabled) return null;
  if (task.trigger.type === 'webhook') {
    return { kind: 'webhook', secret: task.trigger.secret };
  }
  if (task.trigger.type === 'git-hook') {
    const secret = task.trigger.hookSecret ?? '';
    if (!secret) return null;
    return { kind: 'git-hook', secret };
  }
  return null;
}

/**
 * Start the local listener using a persisted preferred port, falling back to
 * the default 38400-38500 range. The chosen port is written back to settings
 * so subsequent boots try it first.
 */
export async function startTriggerListener(): Promise<{ port: number | null }> {
  if (listenerStarted) {
    return { port: getListenerPort() };
  }
  const preferred = getSchedulerListenerPort();
  const info = await startListener({
    preferredPort: preferred,
    lookupTaskSecret: lookupTaskSecret as TaskSecretLookup,
    onTrigger: async ({ taskId }) => {
      await fireTaskById(taskId);
    },
  });
  if (!info) {
    logger.warn('scheduler: listener could not bind to any port in range');
    return { port: null };
  }
  if (preferred !== info.port) {
    setSchedulerListenerPort(info.port);
  }
  listenerStarted = true;
  return { port: info.port };
}

export async function stopTriggerListener(): Promise<void> {
  await stopListener();
  listenerStarted = false;
}

/**
 * Returns the webhook URL for a task, or null when the listener isn't running
 * (which means callbacks would silently 404). The renderer surfaces this in
 * the task editor + History rows.
 */
export function getTriggerUrl(taskId: string): string | null {
  const port = getListenerPort();
  if (port === null) return null;
  return buildTriggerUrl(taskId, port);
}

/**
 * Sync git-hook installations against the current set of enabled git-hook
 * tasks. Called on app boot + after any task create/update/delete.
 *
 * - For each enabled git-hook task, ensure the hook is installed and the
 *   URL/signature are current (idempotent).
 * - Hooks whose task no longer exists are NOT auto-removed (we don't know
 *   which workspace they were installed against unless the task survives);
 *   uninstall flows through the explicit UI button.
 */
export function reinstallAllGitHooks(): { installed: number; errors: string[] } {
  const errors: string[] = [];
  let installed = 0;
  const port = getListenerPort();
  if (port === null) {
    return { installed: 0, errors: ['listener not running'] };
  }
  const portFileWritten = new Set<string>();
  for (const task of listTasks()) {
    if (!task.enabled || task.trigger.type !== 'git-hook') continue;
    const secret = task.trigger.hookSecret;
    if (!secret) {
      errors.push(`${task.name}: no hookSecret stored`);
      continue;
    }
    try {
      installGitHook({
        workspaceRoot: task.workspacePath,
        hook: task.trigger.hook,
        taskId: task.id,
        url: buildTriggerUrl(task.id, port),
        secret,
      });
      if (!portFileWritten.has(task.workspacePath)) {
        try {
          writeListenerPortFile(task.workspacePath, port);
          portFileWritten.add(task.workspacePath);
        } catch (err) {
          errors.push(
            `${task.name} (port file): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      installed += 1;
    } catch (err) {
      errors.push(`${task.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { installed, errors };
}

export function installGitHookForTask(taskId: string): { ok: boolean; error?: string } {
  const task = getTask(taskId);
  if (!task) return { ok: false, error: 'unknown task' };
  if (task.trigger.type !== 'git-hook') {
    return { ok: false, error: 'task trigger is not git-hook' };
  }
  const port = getListenerPort();
  if (port === null) return { ok: false, error: 'listener not running' };
  const secret = task.trigger.hookSecret;
  if (!secret) return { ok: false, error: 'no hookSecret stored on task' };
  try {
    installGitHook({
      workspaceRoot: task.workspacePath,
      hook: task.trigger.hook,
      taskId: task.id,
      url: buildTriggerUrl(task.id, port),
      secret,
    });
    try {
      writeListenerPortFile(task.workspacePath, port);
    } catch (err) {
      return {
        ok: false,
        error: `wrote hook but failed to write port file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function uninstallGitHookForTask(taskId: string): { ok: boolean; error?: string } {
  const task = getTask(taskId);
  if (!task) return { ok: false, error: 'unknown task' };
  if (task.trigger.type !== 'git-hook') {
    return { ok: false, error: 'task trigger is not git-hook' };
  }
  try {
    uninstallGitHook(task.workspacePath, task.trigger.hook as GitHookName);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
