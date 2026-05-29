import { BrowserWindow } from 'electron';
import { registerInvoke } from '../ipc/registry';
import {
  fanoutConsentRequestSchema,
  fanoutConsentRequestedChannel,
  pauseRunRequestSchema,
  resumeRunRequestSchema,
  runPausedChangedChannel,
  worktreePreviewRequestSchema,
  type FanoutConsentResponse,
  type PauseRunResponse,
  type ResumeRunResponse,
  type WorktreePreviewResponse,
} from '../../shared/agent-tree';
import { onFanoutRequested, resolveFanoutConsent } from './fanout-consent';
import { onPausedChanged, pauseRun, resumeRun } from './pause-resume';
import { getWorktreePreview } from './worktree-diff-preview';

export function registerAgentTreeHandlers(): void {
  registerInvoke('agent:pause-run', pauseRunRequestSchema, (req): PauseRunResponse => {
    return pauseRun(req.runId);
  });

  registerInvoke('agent:resume-run', resumeRunRequestSchema, (req): ResumeRunResponse => {
    return resumeRun(req.runId);
  });

  registerInvoke(
    'agent:get-worktree-preview',
    worktreePreviewRequestSchema,
    async (req): Promise<WorktreePreviewResponse> => {
      return await getWorktreePreview(req.runId);
    },
  );

  registerInvoke(
    'agent:fanout-consent',
    fanoutConsentRequestSchema,
    (req): FanoutConsentResponse => {
      return resolveFanoutConsent(req.runId, req.decision, req.editedPlan);
    },
  );

  onPausedChanged((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(runPausedChangedChannel, event);
    }
  });

  onFanoutRequested((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(fanoutConsentRequestedChannel, event);
    }
  });
}
