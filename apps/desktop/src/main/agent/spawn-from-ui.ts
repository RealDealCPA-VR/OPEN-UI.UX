import { BrowserWindow } from 'electron';
import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from './run-registry';
import { resolveRegisteredRunnerId } from './runner-registry-instance';
import { type SubagentResult } from './subagent';
import { isUtilityProcessAvailable, runSubagentInline, runSubagentInWorker } from './worker-host';
import { createWorktree, isGitRepo } from './worktrees';
import { classifyRunnerError } from './runner-friendly-errors';
import { runnerFriendlyErrorChannel } from '../../shared/ipc-types';

export interface SpawnFromUiOptions {
  task: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
  useWorktree: boolean;
  runnerId?: string;
}

interface ActiveSpawn {
  controller: AbortController;
}

const active = new Map<string, ActiveSpawn>();

export function abortSpawnedRun(runId: string): boolean {
  const a = active.get(runId);
  if (!a) return false;
  a.controller.abort();
  return true;
}

export async function spawnFromUiAsync(opts: SpawnFromUiOptions): Promise<{ runId: string }> {
  // The UI passes the exposed runner id (e.g. `claude-code`); plugin runners
  // register under a wrapped id. Resolve once: record the exposed id for
  // display, but drive execution with the registered id.
  const exposedRunnerId = opts.runnerId ?? 'internal';
  const registeredRunnerId = resolveRegisteredRunnerId(exposedRunnerId);
  if (!registeredRunnerId) {
    throw new Error(`Unknown runner: ${exposedRunnerId}`);
  }

  const controller = new AbortController();
  const ctx = await bootstrapWorktreeOrSkip(opts);
  const runId = recordStart({
    task: opts.task,
    providerId: opts.providerId,
    modelId: opts.modelId,
    runnerId: exposedRunnerId,
    ...(ctx.worktreePath ? { worktreePath: ctx.worktreePath } : {}),
    ...(ctx.worktreeBranch ? { worktreeBranch: ctx.worktreeBranch } : {}),
    ...(ctx.repoRoot ? { worktreeRepoRoot: ctx.repoRoot } : {}),
  });
  active.set(runId, { controller });

  void (async () => {
    const workRoot = ctx.worktreePath ?? opts.workspaceRoot;
    let result: SubagentResult;
    try {
      const useWorker = await isUtilityProcessAvailable();
      if (useWorker) {
        try {
          result = await runSubagentInWorker({
            task: opts.task,
            providerId: opts.providerId,
            modelId: opts.modelId,
            workspaceRoot: workRoot,
            signal: controller.signal,
            runnerId: registeredRunnerId,
          });
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'spawn-from-ui worker failed; falling back to inline',
          );
          result = await runSubagentInline({
            task: opts.task,
            providerId: opts.providerId,
            modelId: opts.modelId,
            workspaceRoot: workRoot,
            signal: controller.signal,
            runnerId: registeredRunnerId,
          });
        }
      } else {
        result = await runSubagentInline({
          task: opts.task,
          providerId: opts.providerId,
          modelId: opts.modelId,
          workspaceRoot: workRoot,
          signal: controller.signal,
          runnerId: registeredRunnerId,
        });
      }
      if (exposedRunnerId !== 'internal' && result.stopReason === 'runner_error') {
        broadcastRunnerFriendlyError(exposedRunnerId, result.error ?? '');
      }
      recordComplete(runId, result);
    } catch (err) {
      recordError(runId, err);
    } finally {
      active.delete(runId);
    }
  })();

  return { runId };
}

interface WorktreeCtx {
  worktreePath?: string;
  worktreeBranch?: string;
  repoRoot?: string;
}

function broadcastRunnerFriendlyError(runnerId: string, errText: string): void {
  const payload = classifyRunnerError(runnerId, errText);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(runnerFriendlyErrorChannel, payload);
  }
}

async function bootstrapWorktreeOrSkip(opts: SpawnFromUiOptions): Promise<WorktreeCtx> {
  if (!opts.useWorktree) return {};
  const workspaceIsGit = await isGitRepo(opts.workspaceRoot);
  if (!workspaceIsGit) {
    logger.info(
      { workspaceRoot: opts.workspaceRoot },
      'spawn-from-ui: useWorktree requested but workspace is not a git repo; running directly on the workspace',
    );
    return {};
  }
  try {
    const info = await createWorktree(opts.workspaceRoot);
    return {
      worktreePath: info.path,
      worktreeBranch: info.branch,
      repoRoot: opts.workspaceRoot,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'spawn-from-ui: createWorktree failed; falling back to direct execution',
    );
    return {};
  }
}
