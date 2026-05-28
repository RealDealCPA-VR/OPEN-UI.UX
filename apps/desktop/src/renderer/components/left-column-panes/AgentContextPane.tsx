import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentRun } from '../../../shared/agent-runs';

export default function AgentContextPane(): JSX.Element {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <div className="lcc-pane lcc-pane-agent">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Recent runs</span>
      </div>
      {loadError ? <p className="lcc-pane-error">{loadError}</p> : null}
      {runs === null ? (
        <p className="lcc-pane-empty">Loading…</p>
      ) : runs.length === 0 ? (
        <div className="lcc-pane-empty-state">
          <p className="lcc-pane-empty">No runs yet. Spawn a task to put the agent to work.</p>
          <button
            type="button"
            className="btn btn-primary lcc-pane-cta"
            onClick={() => navigate('/agent?spawn=1')}
          >
            Spawn task
          </button>
        </div>
      ) : (
        <ul className="lcc-list">
          {runs.slice(0, 30).map((run) => (
            <li key={run.id} className="lcc-list-row">
              <button
                type="button"
                className="lcc-list-btn"
                onClick={() => navigate(`/agent/${run.id}`)}
              >
                <span className="lcc-list-title">{truncate(run.task, 60)}</span>
                <span className="lcc-list-meta">
                  <span className={`pill pill-${statusPillClass(run.status)}`}>{run.status}</span>
                  {run.triggerSource === 'scheduled' && (
                    <span className="pill" title="Started by a scheduled task">
                      scheduled
                    </span>
                  )}
                  {run.runnerId !== 'inproc' && run.runnerId !== '' && (
                    <span className="pill" title={`Runner: ${run.runnerId}`}>
                      {run.runnerId}
                    </span>
                  )}
                  <span>{new Date(run.startedAt).toLocaleString()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusPillClass(s: AgentRun['status']): string {
  if (s === 'completed') return 'ok';
  if (s === 'failed') return 'warn';
  return '';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
