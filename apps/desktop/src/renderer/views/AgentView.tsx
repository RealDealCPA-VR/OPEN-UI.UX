import { useCallback, useEffect, useState } from 'react';
import { AgentRunRow } from '../components/AgentRunRow';
import type { AgentRun } from '../../shared/agent-runs';

export function AgentView(): JSX.Element {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await window.opencodex.agent.listRuns();
        if (!cancelled) setRuns(initial);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setRuns([]);
        }
      }
    })();
    const off = window.opencodex.agent.onRunsChanged((payload) => {
      setRuns(payload.runs);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (!runs) return;
    const anyRunning = runs.some((r) => r.status === 'running');
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runs]);

  const onClear = useCallback(async () => {
    setClearing(true);
    try {
      const next = await window.opencodex.agent.clearRuns();
      setRuns(next);
      setExpandedId(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }, []);

  return (
    <section className="view agent-view">
      <h1>Agent</h1>
      <p>
        Subagent runs spawned via <code>spawn_subagent</code>. Newest first.
      </p>

      {loadError && <p className="approvals-save-error">Failed to load runs: {loadError}</p>}

      <div className="agent-view-toolbar">
        <span className="audit-row-duration">
          {runs ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'Loading…'}
        </span>
        <button
          type="button"
          className="audit-clear-button"
          disabled={clearing || !runs || runs.length === 0}
          onClick={() => {
            void onClear();
          }}
        >
          {clearing ? 'Clearing…' : 'Clear history'}
        </button>
      </div>

      {runs && runs.length === 0 && !loadError && (
        <p className="audit-empty">
          No subagent runs yet. They appear here when an orchestrator calls{' '}
          <code>spawn_subagent</code>.
        </p>
      )}

      {runs && runs.length > 0 && (
        <ul className="audit-list">
          {runs.map((run) => (
            <AgentRunRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() => setExpandedId(expandedId === run.id ? null : run.id)}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
