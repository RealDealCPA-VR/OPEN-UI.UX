import type { AgentRun } from '../../shared/agent-runs';
import type { EditAnnotation } from '../components/FileTree';
import type { PendingEditEntry } from '../../shared/codebase-search';

/**
 * Filter the agent runs to those that should be queried for a pending merge
 * bundle: status not 'running', has worktree fields, mergeStatus 'pending'.
 * Rejected or merged runs are excluded so their files don't keep a pill.
 */
export function runsWithPendingEdits(runs: readonly AgentRun[]): AgentRun[] {
  const out: AgentRun[] = [];
  for (const r of runs) {
    if (r.status === 'running') continue;
    if (!r.worktreePath || !r.worktreeBranch || !r.worktreeRepoRoot) continue;
    if (r.mergeStatus !== 'pending') continue;
    out.push(r);
  }
  return out;
}

export interface PendingEditAnnotation {
  status: EditAnnotation;
  count: number;
  runIds: string[];
}

/**
 * Build a path → annotation map from a flat list of pending-edit entries
 * already aggregated by main process. Multiple entries against the same path
 * (e.g. two pending runs touching the same file) aggregate into a single
 * annotation whose `count` reflects how many runs are queued.
 */
export function annotationMapFromPending(
  entries: readonly PendingEditEntry[],
): Record<string, PendingEditAnnotation> {
  const out: Record<string, PendingEditAnnotation> = {};
  for (const e of entries) {
    const existing = out[e.path];
    if (existing) {
      existing.count += 1;
      if (!existing.runIds.includes(e.runId)) existing.runIds.push(e.runId);
    } else {
      out[e.path] = { status: 'pending', count: 1, runIds: [e.runId] };
    }
  }
  return out;
}

/**
 * Cheap fingerprint of the pending-edit-relevant fields of a run list. Used
 * to avoid re-querying main-process diff bundles when nothing changed
 * (since runs-changed events can fire for unrelated state, e.g. token
 * counter updates). Two snapshots with equal fingerprints can reuse the
 * previous pending-edits result.
 */
export function pendingEditsFingerprint(runs: readonly AgentRun[]): string {
  const parts: string[] = [];
  for (const r of runs) {
    if (r.status === 'running') continue;
    if (!r.worktreePath) continue;
    parts.push(`${r.id}:${r.mergeStatus ?? 'none'}:${r.completedAt ?? 0}`);
  }
  parts.sort();
  return parts.join('|');
}
