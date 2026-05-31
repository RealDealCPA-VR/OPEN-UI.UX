import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from '../agent/run-registry';
import { type SubagentResult } from '../agent/subagent';
import {
  isUtilityProcessAvailable,
  runSubagentInline,
  runSubagentInWorker,
} from '../agent/worker-host';
import { createWorktree, isGitRepo } from '../agent/worktrees';
import { getSelectedModel } from '../storage/settings';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { recordRunCompletion, recordRunStart, setTaskRunBookkeeping } from './store';

/**
 * Sentinel value stored in `scheduled_tasks.provider_id` / `model` to mean
 * "re-resolve to the currently selected model at fire time". Used by
 * skill-linked tasks so they follow user model selection instead of pinning
 * to the model that was active when the skill was first synced.
 */
export const CURRENT_SELECTED_MODEL_MARKER = '__current__';

function resolveCurrentMarker(task: ScheduledTask): { providerId: string; model: string } {
  const wantsCurrent =
    task.providerId === CURRENT_SELECTED_MODEL_MARKER ||
    task.model === CURRENT_SELECTED_MODEL_MARKER;
  if (!wantsCurrent) return { providerId: task.providerId, model: task.model };
  let selected: { providerId: string; modelId: string } | null = null;
  try {
    selected = getSelectedModel();
  } catch {
    selected = null;
  }
  if (!selected) {
    throw new Error(
      'scheduled task is configured to use the current selected model, but no model is selected',
    );
  }
  return {
    providerId:
      task.providerId === CURRENT_SELECTED_MODEL_MARKER ? selected.providerId : task.providerId,
    model: task.model === CURRENT_SELECTED_MODEL_MARKER ? selected.modelId : task.model,
  };
}

export interface FireTaskOptions {
  wasCatchup?: boolean;
  /** Override for tests to short-circuit worker/inline branches. */
  runOverride?: (opts: RunSubagentArgs) => Promise<SubagentResult>;
}

export interface RunSubagentArgs {
  task: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
  allowedToolNames?: readonly string[];
  signal: AbortSignal;
  runnerId: string;
}

export interface FireTaskResult {
  runId: string;
  agentRunId: string;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Fire a scheduled task. Persists a row in `scheduled_task_runs`, mirrors the
 * live run in `run-registry`, then runs the subagent (in worktree if requested
 * + git available). Returns when the subagent finishes.
 */
export async function fireScheduledTask(
  task: ScheduledTask,
  opts: FireTaskOptions = {},
): Promise<FireTaskResult> {
  const runId = recordRunStart({
    taskId: task.id,
    status: 'running',
    wasCatchup: opts.wasCatchup ?? false,
  });

  const controller = new AbortController();
  let workRoot = task.workspacePath;
  let worktreeCtx: { worktreePath?: string; worktreeBranch?: string; repoRoot?: string } = {};

  if (task.useWorktree) {
    if (await isGitRepo(task.workspacePath)) {
      try {
        const info = await createWorktree(task.workspacePath);
        workRoot = info.path;
        worktreeCtx = {
          worktreePath: info.path,
          worktreeBranch: info.branch,
          repoRoot: task.workspacePath,
        };
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), taskId: task.id },
          'scheduler: createWorktree failed; falling back to direct execution',
        );
      }
    } else {
      logger.info(
        { taskId: task.id, workspacePath: task.workspacePath },
        'scheduler: useWorktree requested but workspace is not a git repo; running on workspace directly',
      );
    }
  }

  const runnerId = task.runnerId ?? 'internal';

  let resolved: { providerId: string; model: string };
  try {
    resolved = resolveCurrentMarker(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordRunCompletion({ runId, status: 'failed', errorMessage: message });
    setTaskRunBookkeeping(task.id, {
      lastStatus: 'failed',
      lastRunAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    return { runId, agentRunId: '', status: 'failed', error: message };
  }

  const agentRunId = recordStart({
    task: task.prompt,
    providerId: resolved.providerId,
    modelId: resolved.model,
    runnerId,
    ...(worktreeCtx.worktreePath ? { worktreePath: worktreeCtx.worktreePath } : {}),
    ...(worktreeCtx.worktreeBranch ? { worktreeBranch: worktreeCtx.worktreeBranch } : {}),
    ...(worktreeCtx.repoRoot ? { worktreeRepoRoot: worktreeCtx.repoRoot } : {}),
    triggerSource: 'scheduled',
    scheduledTaskId: task.id,
  });

  let result: SubagentResult;
  try {
    const runArgs: RunSubagentArgs = {
      task: task.prompt,
      providerId: resolved.providerId,
      modelId: resolved.model,
      workspaceRoot: workRoot,
      ...(task.allowedTools.length > 0 ? { allowedToolNames: task.allowedTools } : {}),
      signal: controller.signal,
      runnerId,
    };
    if (opts.runOverride) {
      result = await opts.runOverride(runArgs);
    } else {
      result = await runSubagentForTask(runArgs);
    }
    recordComplete(agentRunId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(agentRunId, err);
    recordRunCompletion({
      runId,
      status: 'failed',
      agentRunId,
      errorMessage: message,
    });
    setTaskRunBookkeeping(task.id, {
      lastStatus: 'failed',
      lastRunId: agentRunId,
      lastRunAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    return { runId, agentRunId, status: 'failed', error: message };
  }

  const failed =
    result.stopReason === 'error' ||
    result.stopReason === 'budget_exceeded' ||
    result.stopReason === 'unauthorized_tool';
  const status: 'completed' | 'failed' = failed ? 'failed' : 'completed';

  recordRunCompletion({
    runId,
    status,
    agentRunId,
    ...(result.error ? { errorMessage: result.error } : {}),
  });
  setTaskRunBookkeeping(task.id, {
    lastStatus: status,
    lastRunId: agentRunId,
    lastRunAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });

  return {
    runId,
    agentRunId,
    status,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function runSubagentForTask(args: RunSubagentArgs): Promise<SubagentResult> {
  const useWorker = await isUtilityProcessAvailable();
  if (useWorker) {
    try {
      return await runSubagentInWorker({
        task: args.task,
        providerId: args.providerId,
        modelId: args.modelId,
        workspaceRoot: args.workspaceRoot,
        ...(args.allowedToolNames ? { allowedToolNames: args.allowedToolNames } : {}),
        signal: args.signal,
        runnerId: args.runnerId,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'scheduler: worker run failed; falling back to inline',
      );
    }
  }
  return runSubagentInline({
    task: args.task,
    providerId: args.providerId,
    modelId: args.modelId,
    workspaceRoot: args.workspaceRoot,
    ...(args.allowedToolNames ? { allowedToolNames: args.allowedToolNames } : {}),
    signal: args.signal,
    runnerId: args.runnerId,
  });
}
