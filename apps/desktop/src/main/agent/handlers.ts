import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { acceptMerge, prepareMergeBundle, rejectMerge } from './merge-review';
import { clear, listRuns, onRunsChanged } from './run-registry';
import { abortSpawnedRun, spawnFromUiAsync } from './spawn-from-ui';
import { isGitRepo } from './worktrees';

const runIdRequest = z.object({ runId: z.string().min(1) });

const spawnFromUiSchema = z.object({
  task: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  useWorktree: z.boolean(),
});

const gitIsRepoSchema = z.object({
  path: z.string().min(1),
});

export function registerAgentHandlers(): void {
  registerInvoke('agent:list-runs', z.void(), () => listRuns());
  registerInvoke('agent:clear-runs', z.void(), () => {
    clear();
    return listRuns();
  });

  registerInvoke('agent:get-merge-bundle', runIdRequest, async (req) => {
    const bundle = await prepareMergeBundle(req.runId);
    return {
      runId: bundle.runId,
      diff: bundle.diff,
      files: bundle.files,
      branch: bundle.branch,
    };
  });

  registerInvoke('agent:accept-merge', runIdRequest, async (req) => {
    const outcome = await acceptMerge(req.runId);
    return outcome.error === undefined
      ? { ok: outcome.ok }
      : { ok: outcome.ok, error: outcome.error };
  });

  registerInvoke('agent:reject-merge', runIdRequest, async (req) => {
    const outcome = await rejectMerge(req.runId);
    return outcome.error === undefined
      ? { ok: outcome.ok }
      : { ok: outcome.ok, error: outcome.error };
  });

  registerInvoke('agent:spawn-from-ui', spawnFromUiSchema, async (req) => {
    return spawnFromUiAsync({
      task: req.task,
      providerId: req.providerId,
      modelId: req.modelId,
      workspaceRoot: req.workspaceRoot,
      useWorktree: req.useWorktree,
    });
  });

  registerInvoke('agent:abort-run', runIdRequest, (req) => {
    const aborted = abortSpawnedRun(req.runId);
    return aborted ? { ok: true } : { ok: false, error: 'run not active or not abortable' };
  });

  registerInvoke('git:is-repo', gitIsRepoSchema, async (req) => {
    const isRepo = await isGitRepo(req.path);
    return { isRepo };
  });

  onRunsChanged((runs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:runs-changed', { runs: [...runs] });
    }
  });
}
