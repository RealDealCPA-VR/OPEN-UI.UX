import { useEffect, useState } from 'react';
import type { AgentRun } from '../../shared/agent-runs';
import { pushTransfer } from '../state/transfer';
import {
  canContinueInChat,
  currentToolName,
  formatDurationMs,
  formatTokens,
  hasUnresolvedWorktree,
  runDurationMs,
  statusLabel,
  statusPillClass,
  stopReasonLabel,
} from '../views/agent-runs-derive';

export interface AgentRunDrawerProps {
  run: AgentRun;
  now: number;
  onClose: () => void;
  onOpenMergeReview: (runId: string) => void;
  onContinueInChat: () => void;
}

interface MergeBundlePreview {
  diff: string;
  files: string[];
  branch: string;
}

interface BundleState {
  runId: string;
  bundle: MergeBundlePreview | null;
  err: string | null;
}

export function AgentRunDrawer({
  run,
  now,
  onClose,
  onOpenMergeReview,
  onContinueInChat,
}: AgentRunDrawerProps): JSX.Element {
  const [bundleState, setBundleState] = useState<BundleState | null>(null);

  useEffect(() => {
    if (!hasUnresolvedWorktree(run)) return;
    let cancelled = false;
    const runId = run.id;
    void window.opencodex.agent
      .getMergeBundle(runId)
      .then((b) => {
        if (cancelled) return;
        setBundleState({
          runId,
          bundle: { diff: b.diff, files: b.files, branch: b.branch },
          err: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setBundleState({
          runId,
          bundle: null,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const currentBundleState = bundleState?.runId === run.id ? bundleState : null;
  const bundle = currentBundleState?.bundle ?? null;
  const bundleErr = currentBundleState?.err ?? null;

  const tool = currentToolName(run);
  const duration = runDurationMs(run, now);

  const handleContinue = (): void => {
    pushTransfer({ kind: 'agent-to-chat', runId: run.id, summary: summarizeRun(run) });
    onContinueInChat();
  };

  return (
    <aside className="agent-run-drawer" role="complementary" aria-label="Agent run detail">
      <header className="agent-run-drawer-head">
        <button
          type="button"
          className="agent-run-drawer-close"
          onClick={onClose}
          aria-label="Close run detail"
        >
          ×
        </button>
        <div className="agent-run-drawer-title">
          <span className={statusPillClass(run.status)}>{statusLabel(run.status)}</span>
          <h2>{run.task}</h2>
        </div>
        <div className="agent-run-drawer-meta">
          <span>
            {run.providerId} · {run.modelId}
          </span>
          <span>
            {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
          <span>{formatDurationMs(duration)}</span>
          {tool && (
            <span>
              tool: <code>{tool}</code>
            </span>
          )}
          <span>stop: {stopReasonLabel(run.stopReason)}</span>
        </div>
      </header>

      <div className="agent-run-drawer-actions">
        {hasUnresolvedWorktree(run) && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenMergeReview(run.id)}
          >
            Review changes
          </button>
        )}
        {canContinueInChat(run) && (
          <button type="button" className="btn" onClick={handleContinue}>
            Continue in chat
          </button>
        )}
      </div>

      {run.error && (
        <div className="agent-run-drawer-section">
          <h3>Error</h3>
          <pre className="agent-run-drawer-error">{run.error}</pre>
        </div>
      )}

      <div className="agent-run-drawer-section">
        <h3>Timeline ({run.toolEvents.length})</h3>
        {run.toolEvents.length === 0 ? (
          <p className="audit-empty">No tool events yet.</p>
        ) : (
          <ol className="agent-run-timeline">
            {run.toolEvents.map((evt, idx) => (
              <li
                key={idx}
                className={`agent-run-timeline-item${evt.isError ? ' agent-run-timeline-item-error' : ''}`}
              >
                <span className="agent-run-timeline-step">{idx + 1}</span>
                <code className="agent-run-timeline-tool">{evt.name}</code>
                <span className="agent-run-timeline-dur">{formatDurationMs(evt.durationMs)}</span>
                {evt.isError && <span className="pill audit-error-pill">Error</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {bundle && (
        <div className="agent-run-drawer-section">
          <h3>
            File changes ({bundle.files.length}) · branch <code>{bundle.branch}</code>
          </h3>
          <ul className="merge-review-file-list">
            {bundle.files.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          <pre className="merge-review-diff">{bundle.diff || '(empty diff)'}</pre>
        </div>
      )}
      {bundleErr && (
        <p className="approvals-save-error">Failed to load merge bundle: {bundleErr}</p>
      )}
    </aside>
  );
}

function summarizeRun(run: AgentRun): string {
  const parts: string[] = [];
  parts.push(`Subagent run ${run.id}`);
  parts.push(`Task: ${run.task}`);
  parts.push(`Provider/model: ${run.providerId} / ${run.modelId}`);
  parts.push(`Status: ${run.status} (stop: ${run.stopReason ?? '—'})`);
  parts.push(
    `Tokens: ${run.inputTokens.toLocaleString()} in / ${run.outputTokens.toLocaleString()} out`,
  );
  if (run.toolEvents.length > 0) {
    parts.push(`Tool events: ${run.toolEvents.length}`);
  }
  if (run.error) parts.push(`Error: ${run.error}`);
  return parts.join('\n');
}
