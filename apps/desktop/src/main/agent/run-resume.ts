import { BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { logger } from '../logger';
import { agentResumePromptChannel, type AgentPendingResume } from '../../shared/agent-resume';
import type { AgentRun } from '../../shared/agent-runs';
import { listRunningRuns, markStatus } from './run-store';

let pendingPrompts: AgentPendingResume[] = [];

function toPending(run: AgentRun): AgentPendingResume {
  return {
    runId: run.id,
    task: run.task,
    providerId: run.providerId,
    modelId: run.modelId,
    runnerId: run.runnerId,
    worktreePath: run.worktreePath ?? '',
    worktreeBranch: run.worktreeBranch,
    worktreeRepoRoot: run.worktreeRepoRoot,
    startedAt: new Date(run.startedAt).toISOString(),
  };
}

/**
 * Hydrates the in-memory run-registry from sqlite. Called at app.ready before
 * any windows are created. Side effects:
 * - rows with worktree → become candidates for resume prompt
 * - rows without worktree → marked crashed (status=failed, stop_reason=runner_error)
 */
export function hydrateRunRegistryFromStore(): void {
  let rows: AgentRun[];
  try {
    rows = listRunningRuns();
  } catch (err) {
    logger.warn({ err }, 'run-resume: failed to load running rows');
    return;
  }

  pendingPrompts = [];
  const now = Date.now();

  for (const run of rows) {
    const hasWorktree =
      typeof run.worktreePath === 'string' &&
      run.worktreePath.length > 0 &&
      existsSync(run.worktreePath);
    if (hasWorktree) {
      pendingPrompts.push(toPending(run));
    } else {
      try {
        markStatus(run.id, 'failed', 'runner_error', now);
        logger.info({ runId: run.id }, 'run-resume: marked orphaned running row crashed');
      } catch (err) {
        logger.warn({ err, runId: run.id }, 'run-resume: failed to mark crashed');
      }
    }
  }
}

/** Broadcasts the resume prompt to renderer windows when one becomes available. */
export function promptResumeIfNeeded(): void {
  if (pendingPrompts.length === 0) return;
  const payload = { pending: [...pendingPrompts] };
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) {
    // No windows yet — schedule a one-shot delivery on first window creation.
    setTimeout(promptResumeIfNeeded, 500);
    return;
  }
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(agentResumePromptChannel, payload);
  }
}

/**
 * Removes a runId from the pending-resume queue and returns whether it was
 * present. Used by the respond-resume handler regardless of decision.
 */
export function consumePendingResume(runId: string): boolean {
  const idx = pendingPrompts.findIndex((p) => p.runId === runId);
  if (idx === -1) return false;
  pendingPrompts.splice(idx, 1);
  return true;
}

export function listPendingResumes(): readonly AgentPendingResume[] {
  return pendingPrompts;
}

/** Test-only helper. */
export function __resetForTests(): void {
  pendingPrompts = [];
}
