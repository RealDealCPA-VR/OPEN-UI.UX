import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentRun } from '../../../shared/agent-runs';
import {
  statusPillClass as sharedStatusPillClass,
  statusLabel,
} from '../../views/agent-runs-derive';

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
        <ul className="lcc-list" aria-busy="true" aria-label="Loading runs">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="lcc-list-row lcc-list-row--skeleton">
              <span
                className="settings-skeleton-pulse"
                style={{
                  display: 'block',
                  height: 12,
                  width: '65%',
                  borderRadius: 'var(--radius-xs)',
                  marginBottom: 6,
                }}
              />
              <span
                className="settings-skeleton-pulse"
                style={{
                  display: 'block',
                  height: 10,
                  width: '40%',
                  borderRadius: 'var(--radius-xs)',
                }}
              />
            </li>
          ))}
        </ul>
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
                  <span className={sharedStatusPillClass(run.status)}>
                    {statusLabel(run.status)}
                  </span>
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
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                    title={new Date(run.startedAt).toLocaleString()}
                  >
                    {relativeTime(run.startedAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return 'yesterday';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
