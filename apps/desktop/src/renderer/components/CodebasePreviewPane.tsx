import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import type { CodebaseReadFileResponse } from '../../shared/codebase-search';
import { languageFromPath } from './language-from-extension';

const ReadOnlyEditor = lazy(async () => {
  const [{ loader, default: Editor }, monaco] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor'),
  ]);
  loader.config({ monaco });
  return { default: Editor };
});

interface CodebasePreviewPaneProps {
  workspaceRoot: string | null;
  path: string | null;
  jumpToLine: number | null;
}

interface FetchState {
  workspaceRoot: string;
  path: string;
  file: CodebaseReadFileResponse | null;
  err: string | null;
}

function parseHashLine(hash: string): number | null {
  const m = hash.match(/^#L(\d+)/);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CodebasePreviewPane({
  workspaceRoot,
  path,
  jumpToLine,
}: CodebasePreviewPaneProps): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState | null>(null);
  const [copyLabel, setCopyLabel] = useState<'Copy path' | 'Copied'>('Copy path');
  const [hashLine, setHashLine] = useState<number | null>(() =>
    typeof window !== 'undefined' ? parseHashLine(window.location.hash) : null,
  );
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = (): void => setHashLine(parseHashLine(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!workspaceRoot || !path) return;
    let cancelled = false;
    const reqRoot = workspaceRoot;
    const reqPath = path;
    void window.opencodex.codebase
      .readFile({ workspaceRoot: reqRoot, path: reqPath })
      .then((res) => {
        if (cancelled) return;
        setFetchState({ workspaceRoot: reqRoot, path: reqPath, file: res, err: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchState({
          workspaceRoot: reqRoot,
          path: reqPath,
          file: null,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, path]);

  const targetLine = jumpToLine ?? hashLine;
  const currentForLine =
    fetchState && fetchState.workspaceRoot === workspaceRoot && fetchState.path === path
      ? fetchState
      : null;
  const fileLoadedKey = currentForLine?.file?.path ?? '';

  useEffect(() => {
    if (!editorRef.current || !targetLine || targetLine <= 0) return;
    editorRef.current.revealLineInCenter(targetLine);
    editorRef.current.setPosition({ lineNumber: targetLine, column: 1 });
  }, [targetLine, fileLoadedKey]);

  const handleCopyPath = useCallback(async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy path'), 1200);
    } catch {
      // best-effort
    }
  }, [path]);

  const handleRevealInOs = useCallback(() => {
    if (!workspaceRoot || !path) return;
    void window.opencodex.shell.showItemInFolder(workspaceRoot, path).catch(() => undefined);
  }, [workspaceRoot, path]);

  const current =
    fetchState && fetchState.workspaceRoot === workspaceRoot && fetchState.path === path
      ? fetchState
      : null;
  const file = current?.file ?? null;
  const loadErr = current?.err ?? null;
  const loading = !current && !!workspaceRoot && !!path;

  if (!path) {
    return (
      <div
        className="codebase-preview-pane codebase-preview-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          height: '100%',
          color: 'var(--text-muted, #888)',
        }}
      >
        <p style={{ margin: 0, fontWeight: 500 }}>Select a file to preview</p>
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          Click any file in the tree, or search above.
        </p>
      </div>
    );
  }

  const header = (
    <header
      className="codebase-preview-head"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--border, #333)',
        background: 'var(--bg-elevated, transparent)',
      }}
    >
      <span
        className="codebase-preview-lang"
        aria-label="Language"
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 999,
          background: 'var(--bg-pill, rgba(255,255,255,0.06))',
          color: 'var(--text-secondary, #aaa)',
          textTransform: 'lowercase',
          whiteSpace: 'nowrap',
        }}
      >
        {file?.language || languageFromPath(path)}
      </span>
      <button
        type="button"
        className="codebase-preview-path"
        onClick={() => void handleCopyPath()}
        title="Click to copy path"
        style={{
          flex: 1,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          padding: '2px 4px',
        }}
      >
        {path}
      </button>
      {file ? (
        <span
          className="codebase-preview-meta"
          style={{ fontSize: 11, color: 'var(--text-muted)' }}
        >
          {(file.sizeBytes / 1024).toFixed(1)} KB
          {file.truncated ? ' · truncated' : ''}
        </span>
      ) : null}
      <button
        type="button"
        className="btn"
        onClick={handleRevealInOs}
        title="Open the file's enclosing folder in your OS"
        disabled={!workspaceRoot}
      >
        Open in editor
      </button>
      <button
        type="button"
        className="btn"
        onClick={handleRevealInOs}
        title="Reveal in OS file manager"
        disabled={!workspaceRoot}
      >
        Reveal in OS
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => void handleCopyPath()}
        title="Copy path to clipboard"
      >
        {copyLabel}
      </button>
    </header>
  );

  if (loadErr) {
    return (
      <div className="codebase-preview-pane codebase-preview-error">
        {header}
        <p>
          Failed to load <code>{path}</code>:
        </p>
        <pre>{loadErr}</pre>
      </div>
    );
  }

  if (loading || !file) {
    return (
      <div className="codebase-preview-pane codebase-preview-loading">
        {header}
        <p>
          Loading <code>{path}</code>…
        </p>
      </div>
    );
  }

  const lang = file.language || languageFromPath(file.path);

  return (
    <div className="codebase-preview-pane" style={{ display: 'flex', flexDirection: 'column' }}>
      {header}
      <div className="codebase-preview-editor" style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div className="codebase-preview-loading">Loading editor…</div>}>
          <ReadOnlyEditor
            value={file.content}
            language={lang}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
            }}
            onMount={(ed) => {
              editorRef.current = ed;
              if (targetLine && targetLine > 0) {
                ed.revealLineInCenter(targetLine);
                ed.setPosition({ lineNumber: targetLine, column: 1 });
              }
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
