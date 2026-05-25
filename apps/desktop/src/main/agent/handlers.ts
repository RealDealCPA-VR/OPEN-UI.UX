import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { acceptMerge, prepareMergeBundle, rejectMerge } from './merge-review';
import { clear, listRuns, onRunsChanged } from './run-registry';

const runIdRequest = z.object({ runId: z.string().min(1) });

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

  onRunsChanged((runs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:runs-changed', { runs: [...runs] });
    }
  });
}
