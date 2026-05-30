import { useState } from 'react';
import { getBridge } from '../bridge';
import type { AgentRun } from '../../shared/agent-runs';
import {
  currentToolName,
  formatDurationMs,
  formatTokens,
  runBudget,
  runDurationMs,
  runProgressFraction,
  truncate,
} from '../views/agent-runs-derive';

interface ActiveRunCardProps {
  run: AgentRun;
  now: number;
  onSelect: () => void;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ActiveRunCard({ run, now, onSelect }: ActiveRunCardProps): JSX.Element {
  const [aborting, setAborting] = useState(false);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [abortErr, setAbortErr] = useState<string | null>(null);

  const tool = currentToolName(run);
  const duration = runDurationMs(run, now);
  const budget = runBudget(run);
  const fraction = runProgressFraction(run, budget);
  const segments = Array.from({ length: budget }, (_, i) => i < run.iterations);
  const pulse = !prefersReducedMotion();

  const handleAbort = async (): Promise<void> => {
    if (aborting) return;
    setAborting(true);
    setAbortErr(null);
    try {
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.agent.abortRun(run.id);
      if (!res.ok) setAbortErr(res.error ?? 'abort failed');
    } catch (err) {
      setAbortErr(err instanceof Error ? err.message : String(err));
    } finally {
      setAborting(false);
      setConfirmAbort(false);
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
        {run.runnerId !== 'internal' && (
          <span className="pill pill-runner" title={`Runner: ${run.runnerId}`}>
            {run.runnerId}
          </span>
        )}
        <h3 className="active-run-card-title">{truncate(run.task, 140)}</h3>
      </header>

      <div
        role="progressbar"
        aria-label="Run progress against iteration budget"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(run.iterations, budget)}
        style={{
          display: 'flex',
          gap: 3,
          height: 4,
          width: '100%',
          marginTop: -2,
        }}
      >
        {segments.map((filled, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              borderRadius: 2,
              background: filled ? 'var(--accent)' : 'var(--border-strong)',
              opacity: filled ? 1 : 0.45,
              transition: prefersReducedMotion() ? 'none' : 'background 160ms ease',
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--text-muted)',
          marginTop: -4,
        }}
      >
        <span>
          {run.iterations} / {budget} iterations
        </span>
        <span>{Math.round(fraction * 100)}%</span>
      </div>

      <div className="active-run-card-meta">
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Tokens</span>
          <span className="active-run-card-meta-value">
            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Tool</span>
          <span className="active-run-card-meta-value">
            {tool ? (
              <code
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'var(--accent-soft-bg)',
                  color: 'var(--accent-text)',
                  border: '1px solid var(--accent-soft-border)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    animation: pulse ? 'statusbar-pulse 1.4s ease-in-out infinite' : 'none',
                  }}
                />
                {tool}
              </code>
            ) : (
              <span className="audit-row-duration">idle</span>
            )}
          </span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Elapsed</span>
          <span className="active-run-card-meta-value">{formatDurationMs(duration)}</span>
        </div>
        <div className="active-run-card-meta-item">
          <span className="active-run-card-meta-label">Trigger</span>
          <span className="active-run-card-meta-value">
            {run.triggerSource === 'scheduled' ? 'Scheduled' : 'You'}
          </span>
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
        {!confirmAbort ? (
          <button
            type="button"
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmAbort(true);
            }}
            disabled={aborting}
          >
            Abort
          </button>
        ) : (
          <span
            style={{ display: 'inline-flex', gap: 6 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="btn"
              style={{
                borderColor: 'var(--danger-border)',
                color: 'var(--danger)',
                background: 'var(--danger-bg)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                void handleAbort();
              }}
              disabled={aborting}
              autoFocus
            >
              {aborting ? 'Aborting…' : 'Confirm abort'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAbort(false);
              }}
              disabled={aborting}
            >
              Cancel
            </button>
          </span>
        )}
      </div>
      {abortErr && <p className="approvals-save-error">{abortErr}</p>}
    </article>
  );
}
