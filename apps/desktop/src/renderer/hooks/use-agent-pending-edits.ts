import { useEffect, useRef, useState } from 'react';
import type { AgentRun } from '../../shared/agent-runs';
import type { PendingEditEntry } from '../../shared/codebase-search';
import { pendingEditsFingerprint } from '../views/codebase-pending-edits-derive';

/**
 * Subscribe to agent runs and derive a list of files with pending agent
 * edits. To avoid an N+1 IPC storm we fingerprint the relevant fields of
 * the runs snapshot and only re-fetch when the fingerprint changes (i.e.
 * a run actually moved into/out of the pending-merge state). Token-only
 * updates do not trigger refetches.
 */
export function useAgentPendingEdits(): {
  entries: PendingEditEntry[];
  loading: boolean;
  error: string | null;
} {
  const [entries, setEntries] = useState<PendingEditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFingerprint = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const refetch = async (fingerprint: string): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await window.opencodex.codebase.getPendingEdits();
        if (cancelled) return;
        if (lastFingerprint.current !== fingerprint) {
          // a newer fingerprint arrived while we were fetching; bail and
          // let the newer one's refetch run
          return;
        }
        setEntries(result.entries);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    const handleRuns = (runs: readonly AgentRun[]): void => {
      const fp = pendingEditsFingerprint(runs);
      if (fp === lastFingerprint.current) return;
      lastFingerprint.current = fp;
      if (fp === '') {
        setEntries([]);
        setLoading(false);
        return;
      }
      void refetch(fp);
    };

    (async () => {
      try {
        const runs = await window.opencodex.agent.listRuns();
        if (cancelled) return;
        handleRuns(runs);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();

    const off = window.opencodex.agent.onRunsChanged((payload) => {
      handleRuns(payload.runs);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return { entries, loading, error };
}
