import { useState } from 'react';
import type { AgentRun } from '../../shared/agent-runs';
import {
  currentToolName,
  formatDurationMs,
  formatTokens,
  runDurationMs,
  truncate,
} from '../views/agent-runs-derive';

interface ActiveRunCardProps {
  run: AgentRun;
  now: number;
  onSelect: () => void;
}

const DEFAULT_BUDGET = 10;

export function ActiveRunCard({ run, now, onSelect }: ActiveRunCardProps): JSX.Element {
  const [aborting, setAborting] = useState(false);
  const [abortErr, setAbortErr] = useState<string | null>(null);

  const tool = currentToolName(run);
  const duration = runDurationMs(run, now);

  const handleAbort = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (aborting) return;
    setAborting(true);
    setAbortErr(null);
    try {
      const res = await window.opencodex.agent.abortRun(run.id);
      if (!res.ok) setAbortErr(res.error ?? 'abort failed');
    } catch (err) {
      setAbortErr(err instanceof Error ? err.message : String(err));
    } finally {
      setAborting(false);
    }
  };

  return (
    <article
      className="active-run-card"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <header className="active-run-card-head">
        <span className="pill pill-local">Running</span>
        {run.triggerSource === 'scheduled' && (
          <span className="pill" title="Fired by a scheduled task">
            scheduled
          </span>
        )}
        <h3 className="active-run-card-title">{truncate(run.task, 140)}</h3>
      </header>
      <div className="active-run-card-meta">
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Tokens</span>
          <span className="active-run-card-meta-value">
            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Iterations</span>
          <span className="active-run-card-meta-value">
            {run.iterations} / {DEFAULT_BUDGET}
          </span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Tool</span>
          <span className="active-run-card-meta-value">
            {tool ? <code>{tool}</code> : <span className="audit-row-duration">idle</span>}
          </span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Elapsed</span>
          <span className="active-run-card-meta-value">{formatDurationMs(duration)}</span>
        </div>
      </div>
      <div className="active-run-card-actions">
        <button
          type="button"
          className="btn"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          Open
        </button>
        <button
          type="button"
          className="btn"
          onClick={(e) => void handleAbort(e)}
          disabled={aborting}
        >
          {aborting ? 'Aborting…' : 'Abort'}
        </button>
      </div>
      {abortErr && <p className="approvals-save-error">{abortErr}</p>}
    </article>
  );
}
