import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import {
  extractHunksFromLineChanges,
  formatHunkRange,
  summarizeHunks,
  type MonacoDiffHunk,
} from './monaco-diff-helpers';

export type {
  HunkApplicationInput,
  HunkApplicationResult,
  LineChangeLike,
  MonacoDiffHunk,
} from './monaco-diff-helpers';
export {
  applyHunkDecisions,
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
    height = 360,
    onAccept,
    onReject,
    onAcceptHunk,
    onRejectHunk,
  } = props;

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [hunks, setHunks] = useState<MonacoDiffHunk[]>([]);

  const refreshHunks = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const changes = ed.getLineChanges();
    setHunks(extractHunksFromLineChanges(changes));
  }, []);

  useEffect(() => {
    refreshHunks();
  }, [originalText, modifiedText, refreshHunks]);

  const handleMount = useCallback(
    (ed: editor.IStandaloneDiffEditor) => {
      editorRef.current = ed;
      const disposable = ed.onDidUpdateDiff(() => refreshHunks());
      refreshHunks();
      return () => disposable.dispose();
    },
    [refreshHunks],
  );

  return (
    <div className="monaco-diff-viewer" data-testid="monaco-diff-viewer">
      <div className="monaco-diff-viewer-toolbar">
        <span className="monaco-diff-viewer-summary">{summarizeHunks(hunks)}</span>
        <div className="monaco-diff-viewer-toolbar-actions">
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
          {hunks.map((hunk) => (
            <li key={hunk.index} className="monaco-diff-viewer-hunk">
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
                    onClick={() => onAcceptHunk(hunk.index, hunk)}
                  >
                    Accept hunk
                  </button>
                ) : null}
                {onRejectHunk ? (
                  <button
                    type="button"
                    className="monaco-diff-viewer-hunk-reject"
                    onClick={() => onRejectHunk(hunk.index, hunk)}
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
