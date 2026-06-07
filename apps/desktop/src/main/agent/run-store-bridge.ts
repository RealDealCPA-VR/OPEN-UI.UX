import { logger } from '../logger';
import type { AgentRun } from '../../shared/agent-runs';
import { onRunsChanged } from './run-registry';
import { upsertRun } from './run-store';

let unsubscribe: (() => void) | null = null;
const lastSnapshot = new Map<string, AgentRun>();

function shallowChanged(a: AgentRun, b: AgentRun): boolean {
  return (
    a.status !== b.status ||
    a.completedAt !== b.completedAt ||
    a.inputTokens !== b.inputTokens ||
    a.outputTokens !== b.outputTokens ||
    a.iterations !== b.iterations ||
    a.stopReason !== b.stopReason ||
    a.error !== b.error ||
    a.mergeStatus !== b.mergeStatus ||
    a.seen !== b.seen ||
    a.toolEvents.length !== b.toolEvents.length
  );
}

/**
 * Mirrors every in-memory run-registry change to sqlite. Call once at startup
 * after the DB is open. Idempotent — second invocation is a no-op.
 */
export function startRunStoreBridge(): void {
  if (unsubscribe !== null) return;
  unsubscribe = onRunsChanged((runs) => {
    const seen = new Set<string>();
    for (const run of runs) {
      seen.add(run.id);
      const prev = lastSnapshot.get(run.id);
      if (prev === undefined || shallowChanged(prev, run)) {
        try {
          upsertRun(run);
        } catch (err) {
          logger.warn({ err, runId: run.id }, 'run-store mirror: upsert failed');
        }
        lastSnapshot.set(run.id, run);
      }
    }
    for (const id of [...lastSnapshot.keys()]) {
      if (!seen.has(id)) lastSnapshot.delete(id);
    }
  });
}

export function stopRunStoreBridge(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  lastSnapshot.clear();
}
