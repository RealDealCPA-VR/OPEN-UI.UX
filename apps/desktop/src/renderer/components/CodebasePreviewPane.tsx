import { lazy, Suspense, useEffect, useState } from 'react';
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

export function CodebasePreviewPane({
  workspaceRoot,
  path,
  jumpToLine,
}: CodebasePreviewPaneProps): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState | null>(null);

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
        <p>Select a file to preview.</p>
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="codebase-preview-pane codebase-preview-error">
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
        <p>
          Loading <code>{path}</code>…
        </p>
      </div>
    );
  }

  const lang = file.language || languageFromPath(file.path);

  return (
    <div className="codebase-preview-pane">
      <header className="codebase-preview-head">
        <code className="codebase-preview-path">{file.path}</code>
        <span className="codebase-preview-meta">
          {(file.sizeBytes / 1024).toFixed(1)} KB
          {file.truncated ? ' · truncated' : ''}
        </span>
      </header>
      <div className="codebase-preview-editor">
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
            }}
            onMount={(editor) => {
              if (jumpToLine && jumpToLine > 0) {
                editor.revealLineInCenter(jumpToLine);
                editor.setPosition({ lineNumber: jumpToLine, column: 1 });
              }
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
