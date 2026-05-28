import { useEffect, useMemo, useState } from 'react';
import { MonacoDiffViewer } from './MonacoDiffViewer';

interface MergeReviewModalProps {
  runId: string;
  onClose: () => void;
  onResolved: () => void;
}

interface BundleState {
  diff: string;
  files: string[];
  branch: string;
}

interface ParsedFile {
  path: string;
  added: number;
  removed: number;
  original: string;
  modified: string;
  language: string;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  css: 'css',
  html: 'html',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  swift: 'swift',
};

function languageFor(path: string): string {
  const ext = (path.split('.').at(-1) ?? '').toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext';
}

function parseUnifiedDiff(diff: string): ParsedFile[] {
  if (!diff.trim()) return [];
  const out: ParsedFile[] = [];
  const blocks = diff.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    let path = '';
    const headerMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
    if (headerMatch) path = headerMatch[2] ?? '';
    const originalLines: string[] = [];
    const modifiedLines: string[] = [];
    let added = 0;
    let removed = 0;
    let inHunk = false;
    for (const raw of lines) {
      if (raw.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (raw.startsWith('+++') || raw.startsWith('---')) continue;
      if (raw.startsWith('\\ No newline')) continue;
      if (raw.startsWith('+')) {
        modifiedLines.push(raw.slice(1));
        added++;
      } else if (raw.startsWith('-')) {
        originalLines.push(raw.slice(1));
        removed++;
      } else if (raw.startsWith(' ')) {
        const body = raw.slice(1);
        originalLines.push(body);
        modifiedLines.push(body);
      }
    }
    if (path) {
      out.push({
        path,
        added,
        removed,
        original: originalLines.join('\n'),
        modified: modifiedLines.join('\n'),
        language: languageFor(path),
      });
    }
  }
  return out;
}

export function MergeReviewModal({
  runId,
  onClose,
  onResolved,
}: MergeReviewModalProps): JSX.Element {
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await window.opencodex.agent.getMergeBundle(runId);
        if (!cancelled) {
          setBundle({ diff: b.diff, files: b.files, branch: b.branch });
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const parsedFiles = useMemo<ParsedFile[]>(
    () => (bundle ? parseUnifiedDiff(bundle.diff) : []),
    [bundle],
  );

  useEffect(() => {
    if (!focusedPath && parsedFiles.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedPath(parsedFiles[0]?.path ?? null);
    }
  }, [parsedFiles, focusedPath]);

  const focusedIndex = useMemo(() => {
    const idx = parsedFiles.findIndex((f) => f.path === focusedPath);
    return idx === -1 ? 0 : idx;
  }, [parsedFiles, focusedPath]);

  const focusedFile = parsedFiles[focusedIndex];

  const onAccept = async (): Promise<void> => {
    setBusy('accept');
    setActionError(null);
    try {
      const res = await window.opencodex.agent.acceptMerge(runId);
      if (!res.ok) {
        setActionError(res.error ?? 'merge failed');
        return;
      }
      onResolved();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const onReject = async (): Promise<void> => {
    setBusy('reject');
    setActionError(null);
    try {
      const res = await window.opencodex.agent.rejectMerge(runId);
      if (!res.ok) {
        setActionError(res.error ?? 'reject failed');
        return;
      }
      onResolved();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const openInCodebase = (path: string): void => {
    onClose();
    window.location.hash = `#/codebase?path=${encodeURIComponent(path)}`;
  };

  useEffect(() => {
    if (parsedFiles.length === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (e.key === 'j') {
        e.preventDefault();
        const next = Math.min(parsedFiles.length - 1, focusedIndex + 1);
        const nextPath = parsedFiles[next]?.path;
        if (nextPath) setFocusedPath(nextPath);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = Math.max(0, focusedIndex - 1);
        const prevPath = parsedFiles[prev]?.path;
        if (prevPath) setFocusedPath(prevPath);
      } else if (e.key === 'a') {
        if (!bundle || busy !== null) return;
        e.preventDefault();
        setConfirm('accept');
      } else if (e.key === 'r') {
        if (!bundle || busy !== null) return;
        e.preventDefault();
        setConfirm('reject');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [parsedFiles, focusedIndex, bundle, busy]);

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div
        className="approval-modal merge-review-modal"
        style={{ minWidth: 'min(960px, 92vw)', maxWidth: '96vw' }}
      >
        <header className="approval-modal-header">
          <h2>Review subagent changes</h2>
        </header>

        {loadError && <p className="approvals-save-error">Failed to load diff: {loadError}</p>}

        {!bundle && !loadError && <p>Loading diff…</p>}

        {bundle && (
          <>
            <p className="approval-modal-description">
              Branch <code>{bundle.branch}</code> ·{' '}
              {bundle.files.length === 0
                ? 'no file changes detected'
                : `${bundle.files.length} file${bundle.files.length === 1 ? '' : 's'} changed`}
            </p>

            {parsedFiles.length === 0 ? (
              <pre className="merge-review-diff">{bundle.diff || '(empty diff)'}</pre>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(220px, 280px) 1fr',
                  gap: 12,
                  minHeight: 400,
                  maxHeight: '60vh',
                }}
              >
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    border: '1px solid var(--border-strong)',
                    borderRadius: 6,
                    overflowY: 'auto',
                    background: 'var(--bg-sunken)',
                  }}
                >
                  {parsedFiles.map((f) => {
                    const isActive = f.path === focusedFile?.path;
                    return (
                      <li key={f.path}>
                        <button
                          type="button"
                          onClick={() => setFocusedPath(f.path)}
                          aria-current={isActive ? 'true' : undefined}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: 2,
                            width: '100%',
                            padding: '8px 10px',
                            background: isActive ? 'var(--bg-selected)' : 'transparent',
                            border: 'none',
                            borderLeft: isActive
                              ? '3px solid var(--accent-border, var(--accent, #6366f1))'
                              : '3px solid transparent',
                            borderBottom: '1px solid var(--border-row-divider)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <code
                            style={{
                              fontSize: 12,
                              overflowWrap: 'anywhere',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {f.path}
                          </code>
                          <span style={{ fontSize: 11, display: 'flex', gap: 8 }}>
                            <span style={{ color: 'var(--success)' }}>+{f.added}</span>
                            <span style={{ color: 'var(--danger)' }}>−{f.removed}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                  }}
                >
                  {focusedFile && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 10px',
                          borderBottom: '1px solid var(--border-row-divider)',
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <code style={{ flex: 1, overflowWrap: 'anywhere' }}>
                          {focusedFile.path}
                        </code>
                        <span style={{ color: 'var(--success)' }}>+{focusedFile.added}</span>
                        <span style={{ color: 'var(--danger)' }}>−{focusedFile.removed}</span>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => openInCodebase(focusedFile.path)}
                        >
                          Open in Codebase view
                        </button>
                      </div>
                      <MonacoDiffViewer
                        originalText={focusedFile.original}
                        modifiedText={focusedFile.modified}
                        language={focusedFile.language}
                        height={400}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {actionError && <p className="approvals-save-error">{actionError}</p>}

        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            {confirm === null && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!bundle || busy !== null}
                  onClick={() => setConfirm('accept')}
                >
                  Accept (merge)
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!bundle || busy !== null}
                  onClick={() => setConfirm('reject')}
                >
                  Reject (discard)
                </button>
              </>
            )}
            {confirm === 'accept' && (
              <>
                <span style={{ alignSelf: 'center', fontSize: 13 }}>Merge into base branch?</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => void onAccept()}
                  autoFocus
                >
                  {busy === 'accept' ? 'Merging…' : 'Confirm merge'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </>
            )}
            {confirm === 'reject' && (
              <>
                <span style={{ alignSelf: 'center', fontSize: 13 }}>Discard all changes?</span>
                <button
                  type="button"
                  className="btn"
                  style={{
                    borderColor: 'var(--danger-border)',
                    color: 'var(--danger)',
                    background: 'var(--danger-bg)',
                  }}
                  disabled={busy !== null}
                  onClick={() => void onReject()}
                  autoFocus
                >
                  {busy === 'reject' ? 'Discarding…' : 'Confirm discard'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={onClose}
              style={{ marginLeft: 'auto' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
