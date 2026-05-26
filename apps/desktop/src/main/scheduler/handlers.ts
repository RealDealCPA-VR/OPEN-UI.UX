import { BrowserWindow, Notification, app } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { triggerSchema } from '../triggers/types';
import { generateHookSecret } from './git-hooks';
import { fireScheduledTask } from './runner';
import {
  __resetForTests,
  rescheduleNow,
  startScheduler,
  stopScheduler,
  validateCronExpression,
} from './scheduler';
import { createTask, deleteTask, getRun, getTask, listRuns, listTasks, updateTask } from './store';
import {
  getTriggerUrl,
  installGitHookForTask,
  reinstallAllGitHooks,
  startTriggerListener,
  stopTriggerListener,
  uninstallGitHookForTask,
} from './triggers-lifecycle';

const createRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: triggerSchema,
  prompt: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  workspacePath: z.string().min(1),
  allowedTools: z.array(z.string()).optional(),
  useWorktree: z.boolean().optional(),
  enabled: z.boolean().optional(),
  linkedSkillId: z.string().nullable().optional(),
});

const updateRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  trigger: triggerSchema.optional(),
  prompt: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  allowedTools: z.array(z.string()).optional(),
  useWorktree: z.boolean().optional(),
  enabled: z.boolean().optional(),
  linkedSkillId: z.string().nullable().optional(),
});

const deleteRequestSchema = z.object({ id: z.string().min(1) });
const runNowSchema = z.object({ id: z.string().min(1) });
const getRunSchema = z.object({ id: z.string().min(1) });
const listRunsSchema = z.object({
  taskId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  beforeId: z.string().nullable().optional(),
});

function emitTasksChanged(): void {
  const tasks = listTasks();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('scheduler:tasks-changed', { tasks });
  }
}

function emitRunCompleted(payload: {
  taskId: string;
  agentRunId: string;
  status: 'completed' | 'failed';
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('scheduler:run-completed', {
      taskId: payload.taskId,
      runId: payload.agentRunId,
      status: payload.status,
      agentRunId: payload.agentRunId,
    });
  }
  // Tray notification
  try {
    const task = getTask(payload.taskId);
    if (!task) return;
    if (Notification.isSupported()) {
      const n = new Notification({
        title:
          payload.status === 'completed'
            ? `Scheduled task completed: ${task.name}`
            : `Scheduled task failed: ${task.name}`,
        body: task.description || task.prompt.slice(0, 120),
        silent: false,
      });
      n.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send('app:deep-link', `opencodex://agent/${payload.agentRunId}`);
      });
      n.show();
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'scheduler: tray notification failed',
    );
  }
  emitTasksChanged();
}

export function startSchedulerForApp(opts: { enabledInDev?: boolean } = {}): void {
  const gated = app.isPackaged || opts.enabledInDev === true;
  if (!gated) {
    logger.info('scheduler: not started (dev mode + schedulerEnabledInDev is false)');
    return;
  }
  startScheduler({
    listTasks: () => listTasks(),
    fire: fireScheduledTask,
    onRunCompleted: ({ taskId, agentRunId, status }) =>
      emitRunCompleted({ taskId, agentRunId, status }),
  });
  // Start the local HTTP listener that backs webhook + git-hook triggers.
  // Failure to bind is logged but non-fatal — cron/manual/file-change still work.
  void startTriggerListener()
    .then(({ port }) => {
      if (port !== null) {
        // Re-install all git hooks against the (possibly new) port.
        const res = reinstallAllGitHooks();
        if (res.errors.length > 0) {
          logger.warn({ errors: res.errors }, 'scheduler: some git hooks failed to install');
        } else if (res.installed > 0) {
          logger.info({ installed: res.installed }, 'scheduler: git hooks (re)installed');
        }
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'scheduler: trigger listener startup failed',
      );
    });
}

export function stopSchedulerForApp(): void {
  stopScheduler();
  void stopTriggerListener().catch((err: unknown) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'scheduler: stopTriggerListener failed',
    );
  });
}

export function registerSchedulerHandlers(): void {
  registerInvoke('scheduler:list-tasks', z.void(), () => listTasks());

  registerInvoke('scheduler:create-task', createRequestSchema, (req) => {
    if (req.trigger.type === 'cron') {
      try {
        validateCronExpression(req.trigger.expr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`invalid cron expression: ${msg}`);
      }
    }
    // Git-hook tasks always have a server-generated hookSecret — never trust
    // a client-provided one. Webhook secrets stay client-controlled (the user
    // explicitly creates them in the editor).
    const trigger = ensureGitHookSecret(req.trigger);
    const created = createTask({ ...req, trigger });
    emitTasksChanged();
    rescheduleNow();
    if (created.trigger.type === 'git-hook' && created.enabled) {
      const res = installGitHookForTask(created.id);
      if (!res.ok) {
        logger.warn({ taskId: created.id, error: res.error }, 'scheduler: git hook install failed');
      }
    }
    return created;
  });

  registerInvoke('scheduler:update-task', updateRequestSchema, (req) => {
    if (req.trigger && req.trigger.type === 'cron') {
      try {
        validateCronExpression(req.trigger.expr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`invalid cron expression: ${msg}`);
      }
    }
    const before = getTask(req.id);
    const trigger = req.trigger ? ensureGitHookSecret(req.trigger, before?.trigger) : undefined;
    const updated = updateTask({
      ...req,
      ...(trigger ? { trigger } : {}),
    });
    emitTasksChanged();
    rescheduleNow();
    // Sync git-hook installation against the new state.
    if (before?.trigger.type === 'git-hook' && updated.trigger.type !== 'git-hook') {
      uninstallGitHookForTask(before.id);
    }
    if (updated.trigger.type === 'git-hook' && updated.enabled) {
      installGitHookForTask(updated.id);
    } else if (updated.trigger.type === 'git-hook' && !updated.enabled) {
      uninstallGitHookForTask(updated.id);
    }
    return updated;
  });

  registerInvoke('scheduler:delete-task', deleteRequestSchema, (req) => {
    const before = getTask(req.id);
    if (before?.trigger.type === 'git-hook') {
      uninstallGitHookForTask(before.id);
    }
    deleteTask(req.id);
    emitTasksChanged();
    rescheduleNow();
    return { ok: true };
  });

  registerInvoke('scheduler:run-now', runNowSchema, async (req) => {
    const task = getTask(req.id);
    if (!task) return { ok: false, error: `unknown task: ${req.id}` };
    try {
      const res = await fireScheduledTask(task);
      emitRunCompleted({
        taskId: req.id,
        agentRunId: res.agentRunId,
        status: res.status,
      });
      return {
        ok: res.status === 'completed',
        runId: res.runId,
        agentRunId: res.agentRunId,
        ...(res.error ? { error: res.error } : {}),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  registerInvoke('scheduler:list-runs', listRunsSchema, (req) => {
    return listRuns({
      taskId: req.taskId,
      ...(req.limit !== undefined ? { limit: req.limit } : {}),
      ...(req.beforeId !== undefined ? { beforeId: req.beforeId } : {}),
    });
  });

  registerInvoke('scheduler:get-run', getRunSchema, (req) => {
    return getRun(req.id);
  });

  registerInvoke('scheduler:get-trigger-url', z.object({ taskId: z.string().min(1) }), (req) => ({
    url: getTriggerUrl(req.taskId),
  }));

  registerInvoke('scheduler:install-git-hook', z.object({ taskId: z.string().min(1) }), (req) =>
    installGitHookForTask(req.taskId),
  );

  registerInvoke('scheduler:uninstall-git-hook', z.object({ taskId: z.string().min(1) }), (req) =>
    uninstallGitHookForTask(req.taskId),
  );

  registerInvoke('scheduler:reinstall-git-hooks', z.void(), () => reinstallAllGitHooks());
}

/**
 * Ensure a git-hook trigger has a stable `hookSecret`. New triggers get a
 * freshly generated 32-char hex secret; updates preserve the existing secret
 * unless the trigger explicitly carries a different value.
 */
function ensureGitHookSecret(
  trigger: z.infer<typeof triggerSchema>,
  previous?: z.infer<typeof triggerSchema>,
): z.infer<typeof triggerSchema> {
  if (trigger.type !== 'git-hook') return trigger;
  if (trigger.hookSecret && trigger.hookSecret.length >= 16) return trigger;
  if (previous && previous.type === 'git-hook' && previous.hookSecret) {
    return { ...trigger, hookSecret: previous.hookSecret };
  }
  return { ...trigger, hookSecret: generateHookSecret() };
}

// Test-only re-export
export const __resetSchedulerForTests = __resetForTests;
