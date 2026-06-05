import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRun } from '../../shared/agent-runs';
import type { WorktreePreviewResponse } from '../../shared/agent-tree';
import {
  currentToolName,
  formatTokens,
  runBudget,
  runProgressFraction,
  statusIcon,
  statusPillClass,
  statusLabel,
  truncate,
} from '../views/agent-runs-derive';
import {
  aggregateSubtreeCost,
  buildTree,
  type AgentRunWithParent,
  type TreeNode,
} from './agent-tree-derive';

interface AgentTreeBridge {
  pauseRun?: (runId: string) => Promise<{ ok: boolean; error?: string }>;
  resumeRun?: (runId: string) => Promise<{ ok: boolean; error?: string }>;
  getWorktreePreview?: (runId: string) => Promise<WorktreePreviewResponse>;
  onPausedChanged?: (listener: (payload: { runId: string; paused: boolean }) => void) => () => void;
  abortRun?: (runId: string) => Promise<{ ok: boolean; error?: string }>;
}

function bridge(): AgentTreeBridge | null {
  const win = window as unknown as { opencodex?: { agent?: AgentTreeBridge } };
  return win.opencodex?.agent ?? null;
}

export interface AgentTreeViewProps {
  runs: readonly AgentRunWithParent[];
  now: number;
  onSelectRun: (runId: string) => void;
}

export function AgentTreeView({ runs, now, onSelectRun }: AgentTreeViewProps): JSX.Element {
  const tree = useMemo(() => buildTree(runs), [runs]);
  const [paused, setPaused] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const b = bridge();
    const off = b?.onPausedChanged?.((payload) => {
      setPaused((prev) => {
        const next = new Set(prev);
        if (payload.paused) next.add(payload.runId);
        else next.delete(payload.runId);
        return next;
      });
    });
    return () => {
      if (off) off();
    };
  }, []);

  if (tree.length === 0) {
    return <p className="audit-empty">No runs yet.</p>;
  }

  return (
    <ul
      className="agent-tree-list"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {tree.map((node) => (
        <AgentTreeRow
          key={node.run.id}
          node={node}
          now={now}
          paused={paused}
          onSelectRun={onSelectRun}
        />
      ))}
    </ul>
  );
}

interface AgentTreeRowProps {
  node: TreeNode;
  now: number;
  paused: Set<string>;
  onSelectRun: (runId: string) => void;
}

function AgentTreeRow({ node, now, paused, onSelectRun }: AgentTreeRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [preview, setPreview] = useState<WorktreePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isPaused = paused.has(node.run.id);

  const subtree = useMemo(() => aggregateSubtreeCost(node), [node]);

  const handleAbort = useCallback(async () => {
    const b = bridge();
    if (!b?.abortRun) return;
    try {
      await b.abortRun(node.run.id);
    } catch {
      /* surfaced via run status update */
    }
  }, [node.run.id]);

  const handlePauseToggle = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    try {
      if (isPaused) await b.resumeRun?.(node.run.id);
      else await b.pauseRun?.(node.run.id);
    } catch {
      /* no-op */
    }
  }, [isPaused, node.run.id]);

  const loadPreview = useCallback(async () => {
    const b = bridge();
    if (!b?.getWorktreePreview) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await b.getWorktreePreview(node.run.id);
      if (!mountedRef.current) return;
      setPreview(r);
      if (r.error) setPreviewError(r.error);
    } catch (err) {
      if (!mountedRef.current) return;
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setPreviewLoading(false);
    }
  }, [node.run.id]);

  const run = node.run as AgentRun;
  const tool = currentToolName(run);
  const budget = runBudget(run);
  const fraction = runProgressFraction(run, budget);
  const hasChildren = node.children.length > 0;
  const hasWorktree = run.worktreePath !== null;

  return (
    <li
      className="agent-tree-node"
      data-run-id={node.run.id}
      data-depth={node.depth}
      style={{
        marginLeft: node.depth * 18,
      }}
    >
      <div
        className="agent-tree-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          border: '1px solid var(--border-row-divider)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-panel)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <button
          type="button"
          className="btn"
          aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : 'Leaf node'}
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasChildren}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: hasChildren ? 'pointer' : 'default',
            padding: 0,
            width: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {hasChildren ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
              style={{
                transition: `transform var(--duration-fast, 100ms) var(--ease, cubic-bezier(.4,0,.2,1))`,
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            >
              <path
                d="M1.5 3.5L5 7L8.5 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              ·
            </span>
          )}
        </button>
        <span className={statusPillClass(run.status)} aria-label={statusLabel(run.status)}>
          <span className="pill-icon" aria-hidden="true">
            {statusIcon(run.status)}
          </span>
          {statusLabel(run.status)}
        </span>
        {isPaused && (
          <span className="pill" title="Paused — worker is waiting at next tool turn">
            paused
          </span>
        )}
        <button
          type="button"
          className="agent-tree-task btn"
          onClick={() => onSelectRun(node.run.id)}
          title="Open run detail"
          style={{
            flex: 1,
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 13,
            padding: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {truncate(run.task, 120)}
        </button>
        <div
          role="progressbar"
          aria-label="Iteration budget"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={Math.min(run.iterations, budget)}
          title={`${run.iterations}/${budget} iterations`}
          style={{
            width: 60,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-strong)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${Math.round(fraction * 100)}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
        <span
          style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 84, textAlign: 'right' }}
          title="Subtree token totals (this node + descendants)"
        >
          {formatTokens(subtree.inputTokens)} in / {formatTokens(subtree.outputTokens)} out
        </span>
        {tool && (
          <code
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--accent-soft-bg)',
              color: 'var(--accent-text)',
              border: '1px solid var(--accent-soft-border)',
            }}
            title="Currently running tool"
          >
            {tool}
          </code>
        )}
        {run.status === 'running' && (
          <>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => void handlePauseToggle()}
              title={isPaused ? 'Resume run' : 'Pause run before next tool turn'}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="btn"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderColor: 'var(--danger-border)',
                color: 'var(--danger)',
              }}
              onClick={() => void handleAbort()}
              title="Abort this run"
            >
              Abort
            </button>
          </>
        )}
        {hasWorktree && (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => void loadPreview()}
            disabled={previewLoading}
            title="Show the largest in-progress change in the run's worktree"
          >
            {previewLoading ? 'Loading…' : 'Preview diff'}
          </button>
        )}
      </div>
      {preview && preview.largestFile && (
        <div
          className="agent-tree-preview"
          style={{
            margin: '4px 0 0 32px',
            border: '1px solid var(--border-row-divider)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-sunken)',
            padding: 8,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ marginBottom: 4, color: 'var(--text-primary)' }}>
            <code>{preview.largestFile.path}</code>
            <span style={{ marginLeft: 8, color: 'var(--success)' }}>
              +{preview.largestFile.added}
            </span>{' '}
            <span style={{ color: 'var(--danger)' }}>-{preview.largestFile.removed}</span>
            <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>
              · {preview.totalFilesChanged} file(s) changed
            </span>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {preview.largestFile.hunkSnippet || '(no snippet available)'}
          </pre>
        </div>
      )}
      {previewError && (
        <p className="approvals-save-error" style={{ marginLeft: 32 }}>
          {previewError}
        </p>
      )}
      {hasChildren && expanded && (
        <ul
          className="agent-tree-children"
          style={{ listStyle: 'none', padding: 0, margin: '4px 0 0 0' }}
        >
          {node.children.map((child) => (
            <AgentTreeRow
              key={child.run.id}
              node={child}
              now={now}
              paused={paused}
              onSelectRun={onSelectRun}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
