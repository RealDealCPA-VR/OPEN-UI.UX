import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from '../agent/run-registry';
import { runSubagent, type SubagentResult } from '../agent/subagent';
import { isUtilityProcessAvailable, runSubagentInWorker } from '../agent/worker-host';
import { createWorktree, isGitRepo } from '../agent/worktrees';
import type { ScheduledTask } from '../../shared/scheduled-tasks';
import { recordRunCompletion, recordRunStart, setTaskRunBookkeeping } from './store';

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

  const agentRunId = recordStart({
    task: task.prompt,
    providerId: task.providerId,
    modelId: task.model,
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
      providerId: task.providerId,
      modelId: task.model,
      workspaceRoot: workRoot,
      ...(task.allowedTools.length > 0 ? { allowedToolNames: task.allowedTools } : {}),
      signal: controller.signal,
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
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'scheduler: worker run failed; falling back to inline',
      );
    }
  }
  const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
    import('../chat/provider-builder'),
    import('../tools/registry'),
  ]);
  const provider = await buildProviderForId(args.providerId);
  return runSubagent({
    task: args.task,
    provider,
    modelId: args.modelId,
    toolRegistry: getToolRegistry(),
    ...(args.allowedToolNames ? { allowedToolNames: args.allowedToolNames } : {}),
    workspaceRoot: args.workspaceRoot,
    signal: args.signal,
  });
}
