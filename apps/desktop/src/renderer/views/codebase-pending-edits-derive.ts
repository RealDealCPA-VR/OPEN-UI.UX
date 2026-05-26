import type { AgentRun } from '../../shared/agent-runs';
import type { EditAnnotation } from '../components/FileTree';
import type { PendingEditEntry } from '../../shared/codebase-search';

/**
 * Filter the agent runs to those that should be queried for a pending merge
 * bundle: status not 'running', has worktree fields, mergeStatus 'pending'.
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

/**
 * Build a path → annotation map from a flat list of pending-edit entries
 * already aggregated by main process. The same path appearing in multiple
 * runs collapses to a single 'pending' annotation.
 */
export function annotationMapFromPending(
  entries: readonly PendingEditEntry[],
): Record<string, EditAnnotation> {
  const out: Record<string, EditAnnotation> = {};
  for (const e of entries) {
    out[e.path] = 'pending';
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
