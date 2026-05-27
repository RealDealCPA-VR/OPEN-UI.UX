import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from './run-registry';
import { runnerRegistry } from './runner-registry-instance';
import { type SubagentResult } from './subagent';
import { isUtilityProcessAvailable, runSubagentInline, runSubagentInWorker } from './worker-host';
import { createWorktree, isGitRepo } from './worktrees';

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
  const runnerId = opts.runnerId ?? 'internal';
  if (!runnerRegistry.has(runnerId)) {
    throw new Error(`Unknown runner: ${runnerId}`);
  }

  const controller = new AbortController();
  const ctx = await bootstrapWorktreeOrSkip(opts);
  const runId = recordStart({
    task: opts.task,
    providerId: opts.providerId,
    modelId: opts.modelId,
    runnerId,
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
            runnerId,
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
            runnerId,
          });
        }
      } else {
        result = await runSubagentInline({
          task: opts.task,
          providerId: opts.providerId,
          modelId: opts.modelId,
          workspaceRoot: workRoot,
          signal: controller.signal,
          runnerId,
        });
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

async function bootstrapWorktreeOrSkip(opts: SpawnFromUiOptions): Promise<WorktreeCtx> {
  const runnerId = opts.runnerId ?? 'internal';
  const workspaceIsGit = await isGitRepo(opts.workspaceRoot);
  if (runnerId !== 'internal' && !workspaceIsGit) {
    throw new Error(
      'External runners require a git workspace so changes can be reviewed before merge',
    );
  }
  if (!opts.useWorktree) return {};
  if (!workspaceIsGit) {
    logger.info(
      { workspaceRoot: opts.workspaceRoot },
      'spawn-from-ui: useWorktree requested but workspace is not a git repo; falling back to direct execution',
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
