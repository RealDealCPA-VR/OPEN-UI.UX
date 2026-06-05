import type { AgentRun } from '../../shared/agent-runs';
import { pushTransfer } from '../state/transfer';
import {
  canContinueInChat,
  currentToolName,
  formatDurationMs,
  formatTokens,
  runDurationMs,
  statusIcon,
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
  onContinueInChat?: () => void;
}

export function AgentRunRow({
  run,
  expanded,
  onToggle,
  now,
  onReview,
  onContinueInChat,
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
  const showContinue = canContinueInChat(run);
  const handleContinue = (): void => {
    pushTransfer({
      kind: 'agent-to-chat',
      runId: run.id,
      summary: summarizeRunForChat(run),
    });
    onContinueInChat?.();
  };

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
          <span className={statusPillClass(run.status)}>
            <span className="pill-icon" aria-hidden="true">
              {statusIcon(run.status)}
            </span>
            {statusLabel(run.status)}
          </span>
          <span className="audit-row-duration">
            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
          <span className="audit-row-duration">{formatDurationMs(duration)}</span>
        </button>
        <span className="audit-row-caret" aria-hidden>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: `transform var(--duration-fast) var(--ease)`,
              display: 'block',
            }}
          >
            <path
              d="M3 2L7 5L3 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
          {(showReview || showContinue) && (
            <div className="audit-row-section agent-run-row-actions">
              {showReview && onReview && (
                <button type="button" className="btn btn-primary" onClick={() => onReview(run.id)}>
                  Review changes
                </button>
              )}
              {showContinue && (
                <button
                  type="button"
                  className="btn"
                  onClick={handleContinue}
                  title="Push this run's context into the chat composer"
                >
                  Resume in chat
                </button>
              )}
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

function summarizeRunForChat(run: AgentRun): string {
  const parts: string[] = [];
  parts.push(`Subagent run ${run.id}`);
  parts.push(`Task: ${run.task}`);
  parts.push(`Provider/model: ${run.providerId} / ${run.modelId}`);
  parts.push(`Status: ${run.status} (stop: ${run.stopReason ?? '—'})`);
  parts.push(
    `Tokens: ${run.inputTokens.toLocaleString()} in / ${run.outputTokens.toLocaleString()} out`,
  );
  if (run.toolEvents.length > 0) parts.push(`Tool events: ${run.toolEvents.length}`);
  if (run.error) parts.push(`Error: ${run.error}`);
  return parts.join('\n');
}
