import type { AgentRun } from '../../shared/agent-runs';
import {
  currentToolName,
  formatDurationMs,
  formatTokens,
  runDurationMs,
  statusLabel,
  statusPillClass,
  stopReasonLabel,
  toolErrorCount,
  truncate,
} from '../views/agent-runs-derive';

interface AgentRunRowProps {
  run: AgentRun;
  expanded: boolean;
  onToggle: () => void;
  now: number;
  onReview?: (runId: string) => void;
}

export function AgentRunRow({
  run,
  expanded,
  onToggle,
  now,
  onReview,
}: AgentRunRowProps): JSX.Element {
  const duration = runDurationMs(run, now);
  const tool = currentToolName(run);
  const errors = toolErrorCount(run);
  const showReview =
    onReview !== undefined &&
    run.worktreePath !== null &&
    run.worktreeBranch !== null &&
    run.status !== 'running' &&
    run.mergeStatus === 'pending';

  return (
    <li className="audit-row agent-run-row">
      <div className="audit-row-head">
        <button
          type="button"
          className="audit-row-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} subagent run ${run.id}`}
          onClick={onToggle}
        >
          <span className="audit-row-time">{new Date(run.startedAt).toLocaleTimeString()}</span>
          <span className="audit-row-tool">
            <code className="approvals-tool-name">{truncate(run.task, 80)}</code>
          </span>
          <span className={statusPillClass(run.status)}>{statusLabel(run.status)}</span>
          <span className="audit-row-duration">
            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
          <span className="audit-row-duration">{formatDurationMs(duration)}</span>
        </button>
        <span className="audit-row-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </div>
      {expanded && (
        <div className="audit-row-body">
          <dl className="agent-run-meta">
            <div>
              <dt>Run id</dt>
              <dd>
                <code>{run.id}</code>
              </dd>
            </div>
            <div>
              <dt>Provider / model</dt>
              <dd>
                {run.providerId} · {run.modelId}
              </dd>
            </div>
            <div>
              <dt>Iterations</dt>
              <dd>{run.iterations}</dd>
            </div>
            <div>
              <dt>Tool events</dt>
              <dd>
                {run.toolEvents.length}
                {errors > 0 ? ` (${errors} error${errors === 1 ? '' : 's'})` : ''}
              </dd>
            </div>
            <div>
              <dt>Stop reason</dt>
              <dd>{stopReasonLabel(run.stopReason)}</dd>
            </div>
            {tool && (
              <div>
                <dt>Current tool</dt>
                <dd>
                  <code>{tool}</code>
                </dd>
              </div>
            )}
            {run.worktreeBranch && (
              <div>
                <dt>Worktree branch</dt>
                <dd>
                  <code>{run.worktreeBranch}</code>
                </dd>
              </div>
            )}
            {run.mergeStatus && (
              <div>
                <dt>Merge status</dt>
                <dd>{run.mergeStatus}</dd>
              </div>
            )}
            {run.error && (
              <div>
                <dt>Error</dt>
                <dd className="agent-run-error">{run.error}</dd>
              </div>
            )}
          </dl>
          {showReview && onReview && (
            <div className="audit-row-section">
              <button type="button" className="audit-clear-button" onClick={() => onReview(run.id)}>
                Review changes
              </button>
            </div>
          )}
          {run.toolEvents.length > 0 && (
            <div className="audit-row-section">
              <div className="audit-row-section-head">
                <h4>Timeline</h4>
              </div>
              <ol className="agent-run-timeline">
                {run.toolEvents.map((evt, idx) => (
                  <li
                    key={idx}
                    className={`agent-run-timeline-item${evt.isError ? ' agent-run-timeline-item-error' : ''}`}
                  >
                    <span className="agent-run-timeline-step">{idx + 1}</span>
                    <code className="agent-run-timeline-tool">{evt.name}</code>
                    <span className="agent-run-timeline-dur">
                      {formatDurationMs(evt.durationMs)}
                    </span>
                    {evt.isError && <span className="pill audit-error-pill">Error</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
