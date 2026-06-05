import { useEffect, useState } from 'react';
import type { AgentRun } from '../../shared/agent-runs';
import { getBridge } from '../bridge';
import {
  currentToolName,
  formatDurationMs,
  formatTokens,
  runDurationMs,
  truncate,
} from '../views/agent-runs-derive';

interface JobsPaneProps {
  /** Override for tests — when omitted reads from window.opencodex.agent. */
  initialRuns?: AgentRun[] | null;
}

export function JobsPane({ initialRuns }: JobsPaneProps = {}): JSX.Element {
  const [runs, setRuns] = useState<AgentRun[] | null>(initialRuns ?? null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [abortError, setAbortError] = useState<Record<string, string>>({});
  const [aborting, setAborting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (initialRuns !== undefined) return;
    const bridge = getBridge();
    if (!bridge) {
      setLoadError('Preload bridge unavailable.');
      setRuns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await bridge.agent.listRuns();
        if (!cancelled) setRuns(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setRuns([]);
        }
      }
    })();
    const off = bridge.agent.onRunsChanged((payload) => {
      setRuns(payload.runs);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [initialRuns]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const running = (runs ?? []).filter((r) => r.status === 'running');

  const handleCancel = async (runId: string): Promise<void> => {
    setAborting((m) => ({ ...m, [runId]: true }));
    setAbortError((m) => {
      const next = { ...m };
      delete next[runId];
      return next;
    });
    try {
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.agent.abortRun(runId);
      if (!res.ok) {
        setAbortError((m) => ({ ...m, [runId]: res.error ?? 'cancel failed' }));
      }
    } catch (err) {
      setAbortError((m) => ({
        ...m,
        [runId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setAborting((m) => {
        const next = { ...m };
        delete next[runId];
        return next;
      });
    }
  };

  return (
    <div className="lcc-pane lcc-pane-jobs" data-testid="jobs-pane">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Active jobs</span>
        <span className="lcc-pane-count" aria-label={`${running.length} active`}>
          {running.length}
        </span>
      </div>
      {loadError ? <p className="lcc-pane-error">{loadError}</p> : null}
      {runs === null ? (
        <div
          className="lcc-pane-empty"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          aria-label="Loading jobs"
          aria-busy="true"
        >
          <span className="mcp-inline-spinner" aria-hidden="true" />
          <span>Loading…</span>
        </div>
      ) : running.length === 0 ? (
        <p className="lcc-pane-empty">No active jobs.</p>
      ) : (
        <ul className="lcc-list jobs-pane-list">
          {running.map((run) => {
            const tool = currentToolName(run);
            const duration = runDurationMs(run, now);
            const err = abortError[run.id];
            const busy = aborting[run.id] === true;
            return (
              <li key={run.id} className="lcc-list-row jobs-pane-row" data-run-id={run.id}>
                <div className="jobs-pane-row-head">
                  <span className="pill pill-local">running</span>
                  {run.triggerSource === 'scheduled' && (
                    <span className="pill" title="Scheduled task">
                      scheduled
                    </span>
                  )}
                  <span className="jobs-pane-task" title={run.task}>
                    {truncate(run.task, 60)}
                  </span>
                </div>
                <div className="jobs-pane-meter">
                  <div className="jobs-pane-meter-row">
                    <span className="jobs-pane-meter-label">tokens</span>
                    <span className="jobs-pane-meter-value">
                      {formatTokens(run.inputTokens)} / {formatTokens(run.outputTokens)}
                    </span>
                  </div>
                  <div className="jobs-pane-meter-row">
                    <span className="jobs-pane-meter-label">tool</span>
                    <span className="jobs-pane-meter-value">{tool ?? 'idle'}</span>
                  </div>
                  <div className="jobs-pane-meter-row">
                    <span className="jobs-pane-meter-label">elapsed</span>
                    <span className="jobs-pane-meter-value">{formatDurationMs(duration)}</span>
                  </div>
                </div>
                <div className="jobs-pane-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleCancel(run.id)}
                    disabled={busy}
                  >
                    {busy ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
                {err ? <p className="jobs-pane-row-error">{err}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
