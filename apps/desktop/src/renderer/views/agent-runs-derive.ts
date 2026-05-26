import type { AgentRun, AgentRunStatus, AgentRunStopReason } from '../../shared/agent-runs';

export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function runDurationMs(run: AgentRun, now: number = Date.now()): number {
  if (run.completedAt !== null) return run.completedAt - run.startedAt;
  return Math.max(0, now - run.startedAt);
}

export function formatTokens(n: number): string {
  return n.toLocaleString();
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export function statusLabel(status: AgentRunStatus): string {
  return STATUS_LABEL[status];
}

export function statusPillClass(status: AgentRunStatus): string {
  switch (status) {
    case 'running':
      return 'pill pill-local';
    case 'completed':
      return 'pill pill-ok';
    case 'failed':
      return 'pill pill-warn';
  }
}

const STOP_REASON_LABEL: Record<AgentRunStopReason, string> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  budget_exceeded: 'budget_exceeded',
  error: 'error',
};

export function stopReasonLabel(reason: AgentRunStopReason | null): string {
  if (reason === null) return '—';
  return STOP_REASON_LABEL[reason];
}

export function currentToolName(run: AgentRun): string | null {
  if (run.status !== 'running') return null;
  const last = run.toolEvents[run.toolEvents.length - 1];
  return last ? last.name : null;
}

export function toolErrorCount(run: AgentRun): number {
  let n = 0;
  for (const e of run.toolEvents) if (e.isError) n++;
  return n;
}

export function partitionRunsByActivity(runs: readonly AgentRun[]): {
  active: AgentRun[];
  history: AgentRun[];
} {
  const active: AgentRun[] = [];
  const history: AgentRun[] = [];
  for (const r of runs) {
    if (r.status === 'running') active.push(r);
    else history.push(r);
  }
  return { active, history };
}

/**
 * Returns true when the run has no associated worktree (or merge already
 * resolved). Callers can use this to skip pending-edit derivation.
 */
export function hasUnresolvedWorktree(run: AgentRun): boolean {
  if (!run.worktreePath || !run.worktreeBranch || !run.worktreeRepoRoot) return false;
  return run.mergeStatus === 'pending';
}

export function canContinueInChat(run: AgentRun): boolean {
  return run.status === 'completed' || run.status === 'failed';
}

export function canAbort(run: AgentRun): boolean {
  return run.status === 'running';
}
