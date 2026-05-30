import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRun, AgentRunToolEvent } from '../../shared/agent-runs';
import type { RunnerFriendlyError, RunnerFriendlyErrorKind } from '../../shared/runner-discovery';
import { getBridge } from '../bridge';
import { pushTransfer } from '../state/transfer';
import {
  canContinueInChat,
  currentToolName,
  formatDurationMs,
  formatTokens,
  hasUnresolvedWorktree,
  runDurationMs,
  statusIcon,
  statusLabel,
  statusPillClass,
  stopReasonLabel,
} from '../views/agent-runs-derive';

interface RunnerBridge {
  onFriendlyError?: (listener: (payload: RunnerFriendlyError) => void) => () => void;
}

function runnerBridge(): RunnerBridge | null {
  const bridge = (window as unknown as { opencodex?: { runner?: RunnerBridge } }).opencodex;
  return bridge?.runner ?? null;
}

const KIND_ICON: Record<RunnerFriendlyErrorKind, string> = {
  auth: '🔑',
  'model-not-found': '⚠',
  'rate-limit': '⏱',
  network: '⌧',
  unknown: '⚠',
};

const KIND_LABEL: Record<RunnerFriendlyErrorKind, string> = {
  auth: 'Authentication',
  'model-not-found': 'Model not found',
  'rate-limit': 'Rate limit',
  network: 'Network',
  unknown: 'Error',
};

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

function formatStamp(iso: string | number): string {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function AgentRunDrawer({
  run,
  now,
  onClose,
  onOpenMergeReview,
  onContinueInChat,
}: AgentRunDrawerProps): JSX.Element {
  const [bundleState, setBundleState] = useState<BundleState | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [stickyBottom, setStickyBottom] = useState<boolean>(true);
  const [friendlyError, setFriendlyError] = useState<RunnerFriendlyError | null>(null);
  const [showRawError, setShowRawError] = useState(false);
  const [respawnBusy, setRespawnBusy] = useState<'same' | 'internal' | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const eventRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const bridge = runnerBridge();
    if (!bridge?.onFriendlyError) return;
    const off = bridge.onFriendlyError((payload) => {
      if (payload.runnerId !== run.runnerId) return;
      setFriendlyError(payload);
    });
    return () => {
      off();
    };
  }, [run.runnerId]);

  useEffect(() => {
    // Reset transient UI state when the run we're showing changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFriendlyError(null);
    setShowRawError(false);
  }, [run.id]);

  const handleRespawn = useCallback(
    async (mode: 'same' | 'internal') => {
      setRespawnBusy(mode);
      try {
        const bridge = getBridge();
        if (!bridge) throw new Error('Preload bridge unavailable.');
        const useRunnerId = mode === 'same' ? run.runnerId : 'internal';
        const res = await bridge.agent.spawnFromUi({
          task: run.task,
          providerId: run.providerId,
          modelId: run.modelId,
          workspaceRoot: run.worktreeRepoRoot ?? '',
          useWorktree: useRunnerId !== 'internal',
          runnerId: useRunnerId,
        });
        window.location.hash = `#/agent/${res.runId}`;
      } catch {
        // surface failure via no-op — user can retry
      } finally {
        setRespawnBusy(null);
      }
    },
    [run.runnerId, run.task, run.providerId, run.modelId, run.worktreeRepoRoot],
  );

  const runUnresolved = hasUnresolvedWorktree(run);
  const runContentHash = `${run.mergeStatus ?? ''}|${run.worktreeBranch ?? ''}`;

  useEffect(() => {
    if (!runUnresolved) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    const runId = run.id;
    void bridge.agent
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
    // run object identity intentionally excluded; the content hash captures every field we depend on.
  }, [run.id, runContentHash, runUnresolved]);

  const currentBundleState = bundleState?.runId === run.id ? bundleState : null;
  const bundle = currentBundleState?.bundle ?? null;
  const bundleErr = currentBundleState?.err ?? null;

  const tool = currentToolName(run);
  const duration = runDurationMs(run, now);
  const isRunning = run.status === 'running';

  const events = useMemo(() => run.toolEvents, [run.toolEvents]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const slack = 24;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < slack;
    setStickyBottom(atBottom);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    if (!stickyBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length, isRunning, stickyBottom]);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickyBottom(true);
  }, []);

  const focusEvent = useCallback((idx: number) => {
    setFocusedIdx(idx);
    const el = eventRefs.current[idx];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const root = drawerRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent): void => {
      if (events.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;
      if (e.key === 'j') {
        e.preventDefault();
        const next = Math.min(events.length - 1, focusedIdx < 0 ? 0 : focusedIdx + 1);
        focusEvent(next);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = Math.max(0, focusedIdx <= 0 ? 0 : focusedIdx - 1);
        focusEvent(prev);
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [events.length, focusedIdx, focusEvent]);

  const handleContinue = (): void => {
    pushTransfer({ kind: 'agent-to-chat', runId: run.id, summary: summarizeRun(run) });
    onContinueInChat();
  };

  const toggleEvent = (idx: number): void => {
    setExpandedEvents((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <aside
      ref={drawerRef}
      className="agent-run-drawer"
      role="complementary"
      aria-label="Agent run detail"
      tabIndex={-1}
      style={{ overflow: 'hidden', position: 'fixed' }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
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
            <span className={statusPillClass(run.status)}>
              <span className="pill-icon" aria-hidden="true">
                {statusIcon(run.status)}
              </span>
              {statusLabel(run.status)}
            </span>
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

        {run.stopReason === 'runner_not_installed' && (
          <div className="agent-run-drawer-section agent-run-drawer-callout">
            <h3>Runner not installed</h3>
            <p>
              The runner <code>{run.runnerId}</code> is not installed on this machine. Install it or
              set its CLI path from the Runners panel.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                window.location.hash = '#/runners';
              }}
            >
              Open Runners
            </button>
          </div>
        )}

        {run.stopReason === 'runner_error' && friendlyError && (
          <div className="agent-run-drawer-section agent-run-drawer-callout">
            <h3>
              <span aria-hidden style={{ marginRight: 6 }}>
                {KIND_ICON[friendlyError.kind]}
              </span>
              {KIND_LABEL[friendlyError.kind]}
            </h3>
            <p>{friendlyError.message}</p>
            {friendlyError.suggestedFix && (
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                }}
              >
                Suggested fix: {friendlyError.suggestedFix}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={respawnBusy !== null}
                onClick={() => void handleRespawn('same')}
              >
                {respawnBusy === 'same' ? 'Re-spawning…' : `Retry with ${run.runnerId}`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={respawnBusy !== null}
                onClick={() => void handleRespawn('internal')}
              >
                {respawnBusy === 'internal' ? 'Re-spawning…' : 'Re-spawn with internal runner'}
              </button>
            </div>
            {run.error && (
              <details
                style={{ marginTop: 8 }}
                open={showRawError}
                onToggle={(e) => setShowRawError((e.target as HTMLDetailsElement).open)}
              >
                <summary style={{ cursor: 'pointer', fontSize: 12 }}>Show raw error</summary>
                <pre className="agent-run-drawer-error" style={{ marginTop: 6 }}>
                  {run.error}
                </pre>
              </details>
            )}
          </div>
        )}

        {run.error && !(run.stopReason === 'runner_error' && friendlyError) && (
          <div className="agent-run-drawer-section">
            <h3>Error</h3>
            <pre className="agent-run-drawer-error">{run.error}</pre>
          </div>
        )}

        <div className="agent-run-drawer-section">
          <h3>
            Activity log ({events.length})
            <span
              style={{
                marginLeft: 8,
                fontWeight: 400,
                textTransform: 'none',
                letterSpacing: 0,
                color: 'var(--text-faint)',
              }}
            >
              · j/k to navigate
            </span>
          </h3>
          {events.length === 0 ? (
            <p className="audit-empty">No tool events yet.</p>
          ) : (
            <ol
              className="agent-run-timeline"
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {events.map((evt, idx) => {
                const isExpanded = expandedEvents[idx] ?? false;
                const isFocused = focusedIdx === idx;
                return (
                  <li
                    key={idx}
                    ref={(el) => {
                      eventRefs.current[idx] = el;
                    }}
                    className={`agent-run-timeline-item${evt.isError ? ' agent-run-timeline-item-error' : ''}`}
                    style={{
                      outline: isFocused ? '1px solid var(--accent-soft-border)' : 'none',
                      outlineOffset: 1,
                      borderRadius: 4,
                      cursor: 'pointer',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                    onClick={() => {
                      focusEvent(idx);
                      toggleEvent(idx);
                    }}
                  >
                    <ToolEventRow
                      idx={idx}
                      evt={evt}
                      startedAt={run.startedAt}
                      expanded={isExpanded}
                    />
                  </li>
                );
              })}
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
      </div>

      {isRunning && !stickyBottom && (
        <button
          type="button"
          className="btn"
          onClick={jumpToBottom}
          style={{
            position: 'absolute',
            right: 20,
            bottom: hasUnresolvedWorktree(run) || canContinueInChat(run) ? 76 : 20,
            zIndex: 1,
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          Jump to latest ↓
        </button>
      )}

      {(hasUnresolvedWorktree(run) || canContinueInChat(run)) && (
        <footer
          style={{
            background: 'var(--bg-panel)',
            paddingTop: 12,
            borderTop: '1px solid var(--border-strong)',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
          }}
        >
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
        </footer>
      )}
    </aside>
  );
}

interface ToolEventRowProps {
  idx: number;
  evt: AgentRunToolEvent;
  startedAt: number;
  expanded: boolean;
}

function ToolEventRow({ idx, evt, startedAt, expanded }: ToolEventRowProps): JSX.Element {
  return (
    <>
      <span
        style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          color: 'var(--text-muted)',
          fontSize: 11,
          marginRight: 6,
        }}
      >
        {formatStamp(startedAt + idx)}
      </span>
      <span className="agent-run-timeline-step">{idx + 1}</span>
      <code className="agent-run-timeline-tool">{evt.name}</code>
      <span className="agent-run-timeline-dur">{formatDurationMs(evt.durationMs)}</span>
      {evt.isError && <span className="pill audit-error-pill">Error</span>}
      <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 10 }}>
        {expanded ? '▾' : '▸'}
      </span>
      {expanded && (
        <div
          style={{
            flexBasis: '100%',
            marginTop: 6,
            padding: '6px 10px',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border-row-divider)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          }}
        >
          <div>tool: {evt.name}</div>
          <div>duration: {formatDurationMs(evt.durationMs)}</div>
          <div>status: {evt.isError ? 'error' : 'ok'}</div>
        </div>
      )}
    </>
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
