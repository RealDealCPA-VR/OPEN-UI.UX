import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import type { CodebaseReadFileResponse } from '../../shared/codebase-search';
import { getBridge } from '../bridge';
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
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    const reqRoot = workspaceRoot;
    const reqPath = path;
    void bridge.codebase
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
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.shell.showItemInFolder(workspaceRoot, path).catch(() => undefined);
  }, [workspaceRoot, path]);

  const handleOpenInEditor = useCallback(() => {
    if (!workspaceRoot || !path) return;
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.shell.openPath(workspaceRoot, path).catch(() => undefined);
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
      <div className="codebase-preview-pane codebase-preview-empty">
        <p style={{ margin: 0, fontWeight: 500 }}>Select a file to preview</p>
        <p style={{ margin: 'var(--space-3) 0 0' }}>Click any file in the tree, or search above.</p>
      </div>
    );
  }

  const header = (
    <header
      className="codebase-preview-head"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-5)',
      }}
    >
      <span
        className="codebase-preview-lang"
        aria-label="Language"
        style={{
          fontSize: 11,
          padding: '2px var(--space-4)',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--bg-btn)',
          color: 'var(--text-secondary)',
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
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          padding: '2px var(--space-2)',
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
      <div
        className="codebase-preview-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
      >
        <button
          type="button"
          className="btn"
          style={{ opacity: 0.7, fontSize: 11 }}
          onClick={handleOpenInEditor}
          title="Open this file in your OS default editor"
          disabled={!workspaceRoot}
        >
          Open in editor
        </button>
        <button
          type="button"
          className="btn"
          style={{ opacity: 0.7, fontSize: 11 }}
          onClick={handleRevealInOs}
          title="Reveal in OS file manager"
          disabled={!workspaceRoot}
        >
          Reveal in OS
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleCopyPath()}
          title="Copy path to clipboard"
          style={{ fontSize: 11, minWidth: 80, position: 'relative' }}
        >
          <span
            style={{
              opacity: copyLabel === 'Copy path' ? 1 : 0,
              transition: `opacity var(--duration-fast) var(--ease)`,
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Copy path
          </span>
          <span
            style={{
              opacity: copyLabel === 'Copied' ? 1 : 0,
              transition: `opacity var(--duration-fast) var(--ease)`,
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Copied
          </span>
          {/* spacer keeps button width stable */}
          <span aria-hidden style={{ visibility: 'hidden' }}>
            Copy path
          </span>
        </button>
      </div>
    </header>
  );

  if (loadErr) {
    return (
      <div className="codebase-preview-pane codebase-preview-error">
        {header}
        <div
          style={{
            margin: 'var(--space-6)',
            padding: 'var(--space-5)',
            borderRadius: 'var(--radius)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            color: 'var(--danger)',
          }}
        >
          <p style={{ margin: '0 0 var(--space-3)', fontWeight: 500 }}>
            Failed to load{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>{path}</code>
          </p>
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--danger-soft)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {loadErr}
          </pre>
        </div>
      </div>
    );
  }

  if (loading || !file) {
    return (
      <div className="codebase-preview-pane codebase-preview-loading">
        {header}
        <div
          style={{
            margin: 'var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {[80, 60, 70].map((w, i) => (
            <div
              key={i}
              className="settings-skeleton-pulse"
              style={{
                height: 12,
                width: `${w}%`,
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-btn)',
                animationDelay: `${i * 80}ms`,
              }}
            />
          ))}
        </div>
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
