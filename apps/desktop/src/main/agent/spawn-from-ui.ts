import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from './run-registry';
import { runSubagent, type SubagentResult } from './subagent';
import { isUtilityProcessAvailable, runSubagentInWorker } from './worker-host';
import { createWorktree, isGitRepo } from './worktrees';

export interface SpawnFromUiOptions {
  task: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
  useWorktree: boolean;
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
  const controller = new AbortController();
  const ctx = await bootstrapWorktreeOrSkip(opts);
  const runId = recordStart({
    task: opts.task,
    providerId: opts.providerId,
    modelId: opts.modelId,
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
          });
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'spawn-from-ui worker failed; falling back to inline',
          );
          result = await runInline(opts, workRoot, controller.signal);
        }
      } else {
        result = await runInline(opts, workRoot, controller.signal);
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
  if (!opts.useWorktree) return {};
  if (!(await isGitRepo(opts.workspaceRoot))) {
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

async function runInline(
  opts: SpawnFromUiOptions,
  workRoot: string,
  signal: AbortSignal,
): Promise<SubagentResult> {
  const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
    import('../chat/provider-builder'),
    import('../tools/registry'),
  ]);
  const provider = await buildProviderForId(opts.providerId);
  return runSubagent({
    task: opts.task,
    provider,
    modelId: opts.modelId,
    toolRegistry: getToolRegistry(),
    workspaceRoot: workRoot,
    signal,
  });
}
