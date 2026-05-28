import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import {
  countLineDelta,
  extractHunksFromLineChanges,
  formatHunkRange,
  summarizeHunks,
  type MonacoDiffHunk,
} from './monaco-diff-helpers';

export type {
  HunkApplicationInput,
  HunkApplicationResult,
  HunkLineDelta,
  LineChangeLike,
  MonacoDiffHunk,
} from './monaco-diff-helpers';
export {
  applyHunkDecisions,
  countLineDelta,
  extractHunksFromLineChanges,
  formatHunkRange,
  summarizeHunks,
} from './monaco-diff-helpers';

const DiffEditor = lazy(async () => {
  const [{ loader, DiffEditor: DE }, monaco] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor'),
  ]);
  loader.config({ monaco });
  return { default: DE };
});

export interface MonacoDiffViewerProps {
  originalText: string;
  modifiedText: string;
  language?: string;
  filePath?: string;
  height?: number | string;
  onAccept?: () => void;
  onReject?: () => void;
  onAcceptHunk?: (hunkIndex: number, hunk: MonacoDiffHunk) => void;
  onRejectHunk?: (hunkIndex: number, hunk: MonacoDiffHunk) => void;
}

export function MonacoDiffViewer(props: MonacoDiffViewerProps): JSX.Element {
  const {
    originalText,
    modifiedText,
    language,
    filePath,
    height = 360,
    onAccept,
    onReject,
    onAcceptHunk,
    onRejectHunk,
  } = props;

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hunks, setHunks] = useState<MonacoDiffHunk[]>([]);
  const [activeHunkIdx, setActiveHunkIdx] = useState(0);

  const refreshHunks = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const changes = ed.getLineChanges();
    const next = extractHunksFromLineChanges(changes);
    setHunks(next);
    setActiveHunkIdx((prev) => (prev >= next.length ? 0 : prev));
  }, []);

  useEffect(() => {
    refreshHunks();
  }, [originalText, modifiedText, refreshHunks]);

  const revealHunk = useCallback((hunk: MonacoDiffHunk) => {
    const ed = editorRef.current;
    if (!ed) return;
    const modEditor = ed.getModifiedEditor();
    const targetLine =
      hunk.modifiedEndLine < hunk.modifiedStartLine
        ? hunk.modifiedStartLine
        : hunk.modifiedStartLine;
    modEditor.revealLineInCenter(Math.max(1, targetLine));
  }, []);

  const handleMount = useCallback(
    (ed: editor.IStandaloneDiffEditor) => {
      editorRef.current = ed;
      const disposable = ed.onDidUpdateDiff(() => refreshHunks());
      refreshHunks();
      return () => disposable.dispose();
    },
    [refreshHunks],
  );

  const stats = useMemo(() => countLineDelta(hunks), [hunks]);

  const stickyLabel = useMemo(() => {
    const plus = `+${stats.added}`;
    const minus = `-${stats.removed}`;
    return `${plus} ${minus}`;
  }, [stats]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (hunks.length === 0) return;
      if (e.key === 'j') {
        e.preventDefault();
        setActiveHunkIdx((prev) => {
          const next = Math.min(prev + 1, hunks.length - 1);
          const target = hunks[next];
          if (target) revealHunk(target);
          return next;
        });
      } else if (e.key === 'k') {
        e.preventDefault();
        setActiveHunkIdx((prev) => {
          const next = Math.max(prev - 1, 0);
          const target = hunks[next];
          if (target) revealHunk(target);
          return next;
        });
      } else if (e.key === 'a' && onAcceptHunk) {
        const hunk = hunks[activeHunkIdx];
        if (hunk) {
          e.preventDefault();
          onAcceptHunk(hunk.index, hunk);
        }
      } else if (e.key === 'r' && onRejectHunk) {
        const hunk = hunks[activeHunkIdx];
        if (hunk) {
          e.preventDefault();
          onRejectHunk(hunk.index, hunk);
        }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [hunks, activeHunkIdx, onAcceptHunk, onRejectHunk, revealHunk]);

  return (
    <div
      className="monaco-diff-viewer"
      data-testid="monaco-diff-viewer"
      ref={containerRef}
      tabIndex={0}
    >
      {filePath || hunks.length > 0 ? (
        <div
          className="monaco-diff-viewer-sticky-header"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 10px',
            background: 'var(--bg-elevated, #1e1e1e)',
            borderBottom: '1px solid var(--border, #333)',
            fontSize: 12,
          }}
        >
          {filePath ? (
            <code
              className="monaco-diff-viewer-sticky-path"
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              title={filePath}
            >
              {filePath}
            </code>
          ) : (
            <span style={{ flex: 1 }} />
          )}
          <span
            className="monaco-diff-viewer-sticky-stats"
            aria-label={`${stats.added} added, ${stats.removed} removed`}
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-secondary, #aaa)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: 'var(--diff-add-fg, #4ec9b0)' }}>+{stats.added}</span>{' '}
            <span style={{ color: 'var(--diff-del-fg, #f48771)' }}>-{stats.removed}</span>
          </span>
          <span style={{ color: 'var(--text-muted, #888)', whiteSpace: 'nowrap' }}>
            {stickyLabel === '+0 -0' ? '' : null}
          </span>
        </div>
      ) : null}
      <div className="monaco-diff-viewer-toolbar">
        <span className="monaco-diff-viewer-summary">{summarizeHunks(hunks)}</span>
        <div className="monaco-diff-viewer-toolbar-actions">
          {hunks.length > 0 && (onAcceptHunk || onRejectHunk) ? (
            <span
              className="monaco-diff-viewer-keys"
              style={{
                fontSize: 11,
                color: 'var(--text-muted, #888)',
                marginRight: 8,
              }}
              aria-hidden
            >
              j/k · a/r
            </span>
          ) : null}
          {onAccept ? (
            <button type="button" className="monaco-diff-viewer-accept-all" onClick={onAccept}>
              Accept all
            </button>
          ) : null}
          {onReject ? (
            <button type="button" className="monaco-diff-viewer-reject-all" onClick={onReject}>
              Reject all
            </button>
          ) : null}
        </div>
      </div>
      <div className="monaco-diff-viewer-editor" style={{ height }}>
        <Suspense
          fallback={<div className="monaco-diff-viewer-loading">Loading Monaco editor…</div>}
        >
          <DiffEditor
            original={originalText}
            modified={modifiedText}
            language={language}
            options={{
              readOnly: true,
              renderSideBySide: true,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
            }}
            onMount={handleMount}
          />
        </Suspense>
      </div>
      {hunks.length > 0 && (onAcceptHunk || onRejectHunk) ? (
        <ul className="monaco-diff-viewer-hunks">
          {hunks.map((hunk, idx) => (
            <li
              key={hunk.index}
              className="monaco-diff-viewer-hunk"
              data-active={idx === activeHunkIdx ? 'true' : undefined}
              style={
                idx === activeHunkIdx
                  ? { outline: '1px solid var(--accent, #4d9aff)', outlineOffset: -1 }
                  : undefined
              }
            >
              <span
                className={`monaco-diff-viewer-hunk-kind monaco-diff-viewer-hunk-kind-${hunk.kind}`}
              >
                {hunk.kind}
              </span>
              <span className="monaco-diff-viewer-hunk-range">{formatHunkRange(hunk)}</span>
              <div className="monaco-diff-viewer-hunk-actions">
                {onAcceptHunk ? (
                  <button
                    type="button"
                    className="monaco-diff-viewer-hunk-accept"
                    onClick={() => {
                      setActiveHunkIdx(idx);
                      onAcceptHunk(hunk.index, hunk);
                    }}
                  >
                    Accept hunk
                  </button>
                ) : null}
                {onRejectHunk ? (
                  <button
                    type="button"
                    className="monaco-diff-viewer-hunk-reject"
                    onClick={() => {
                      setActiveHunkIdx(idx);
                      onRejectHunk(hunk.index, hunk);
                    }}
                  >
                    Reject hunk
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
