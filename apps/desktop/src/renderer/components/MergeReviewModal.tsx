import { useEffect, useMemo, useRef, useState } from 'react';
import { MonacoDiffViewer } from './MonacoDiffViewer';
import type { HunkProvenance, MonacoDiffHunk } from './monaco-diff-helpers';
import { DraftPrModal } from './DraftPrModal';
import { MergeConflictResolver } from './MergeConflictResolver';
import { getBridge } from '../bridge';
import type { AppliedDiff } from '../../shared/replay';

interface MergeReviewModalProps {
  runId: string;
  conversationId: string;
  workspaceRoot: string;
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

interface RegenerateState {
  filePath: string;
  hunk: MonacoDiffHunk;
  originalSnippet: string;
  modifiedSnippet: string;
  instruction: string;
  busy: boolean;
  suggestion: string | null;
  error: string | null;
}

interface WhyDetails {
  promptSnapshot: string | null;
  toolCallSummary: string | null;
  ragCitations: string[];
  providerId: string | null;
  modelId: string | null;
  costUsd: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  appliedAt: string | null;
}

export function parseRagCitations(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((c) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object') {
            const obj = c as Record<string, unknown>;
            const file = typeof obj['filePath'] === 'string' ? obj['filePath'] : null;
            const start = typeof obj['startLine'] === 'number' ? obj['startLine'] : null;
            const end = typeof obj['endLine'] === 'number' ? obj['endLine'] : null;
            if (file && start !== null && end !== null) return `${file}:${start}-${end}`;
            if (file && start !== null) return `${file}:${start}`;
            if (file) return file;
          }
          return null;
        })
        .filter((s): s is string => s !== null);
    }
  } catch {
    // fall through
  }
  return [];
}

function appliedDiffToWhy(d: AppliedDiff): WhyDetails {
  return {
    promptSnapshot: d.promptSnapshot,
    toolCallSummary: d.toolCallId ?? null,
    ragCitations: parseRagCitations(d.ragCitationsJson),
    providerId: d.providerId,
    modelId: d.modelId,
    costUsd: d.costUsd,
    tokensInput: d.tokensInput,
    tokensOutput: d.tokensOutput,
    appliedAt: d.appliedAt,
  };
}

function snippetFromText(text: string, startLine: number, endLine: number): string {
  if (endLine < startLine) return '';
  const lines = text.split('\n');
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start, end).join('\n');
}

export function MergeReviewModal({
  runId,
  conversationId,
  workspaceRoot,
  onClose,
  onResolved,
}: MergeReviewModalProps): JSX.Element {
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [whyOpenFor, setWhyOpenFor] = useState<number | null>(null);
  const [provenance] = useState<Record<string, HunkProvenance[]>>({});
  const [appliedDiffsByFile, setAppliedDiffsByFile] = useState<Record<string, AppliedDiff[]>>({});
  // Local in-modal override of modified text per file, set when the user
  // accepts a regenerated hunk suggestion. Does NOT touch disk — final
  // commit is governed by acceptMerge of the worktree branch.
  const [modifiedOverrides, setModifiedOverrides] = useState<Record<string, string>>({});
  const [regenerate, setRegenerate] = useState<RegenerateState | null>(null);
  const [showDraftPr, setShowDraftPr] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const modalRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadError('Preload bridge unavailable.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const b = await bridge.agent.getMergeBundle(runId);
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

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await bridge.replay.listAppliedDiffs({
          conversationId,
          limit: 200,
        });
        if (cancelled) return;
        const byFile: Record<string, AppliedDiff[]> = {};
        for (const row of res.rows) {
          const existing = byFile[row.filePath];
          if (existing) existing.push(row);
          else byFile[row.filePath] = [row];
        }
        setAppliedDiffsByFile(byFile);
      } catch {
        // best-effort — Why? falls back to empty state below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

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
    setConflictError(null);
    try {
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.agent.acceptMerge(runId);
      if (!res.ok) {
        const msg = res.error ?? 'merge failed';
        setActionError(msg);
        if (/conflict|automatic merge failed|CONFLICT/i.test(msg)) {
          setConflictError(msg);
        }
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
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.agent.rejectMerge(runId);
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

  const openRegenerate = (hunk: MonacoDiffHunk): void => {
    if (!focusedFile) return;
    setRegenerate({
      filePath: focusedFile.path,
      hunk,
      originalSnippet: snippetFromText(
        focusedFile.original,
        hunk.originalStartLine,
        hunk.originalEndLine,
      ),
      modifiedSnippet: snippetFromText(
        focusedFile.modified,
        hunk.modifiedStartLine,
        hunk.modifiedEndLine,
      ),
      instruction: '',
      busy: false,
      suggestion: null,
      error: null,
    });
  };

  const submitRegenerate = async (): Promise<void> => {
    if (!regenerate) return;
    setRegenerate({ ...regenerate, busy: true, error: null, suggestion: null });
    try {
      const bridge = getBridge();
      if (!bridge) {
        setRegenerate((r) => (r ? { ...r, busy: false, error: 'Preload bridge unavailable.' } : r));
        return;
      }
      const selected = await bridge.selectedModel.get();
      if (!selected) {
        setRegenerate((r) => (r ? { ...r, busy: false, error: 'No model selected' } : r));
        return;
      }
      const res = await bridge.chat.regenerateHunk({
        conversationId,
        filePath: regenerate.filePath,
        originalSnippet: regenerate.originalSnippet,
        modifiedSnippet: regenerate.modifiedSnippet,
        instruction: regenerate.instruction,
        providerId: selected.providerId,
        modelId: selected.modelId,
        language: focusedFile?.language ?? 'plaintext',
      });
      if (!res.ok) {
        setRegenerate((r) =>
          r ? { ...r, busy: false, error: res.error ?? 'regenerate failed' } : r,
        );
        return;
      }
      setRegenerate((r) => (r ? { ...r, busy: false, suggestion: res.suggestion ?? '' } : r));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRegenerate((r) => (r ? { ...r, busy: false, error: message } : r));
    }
  };

  const provenanceFor = (filePath: string): HunkProvenance[] => provenance[filePath] ?? [];

  const whyDetailsFor = (filePath: string): WhyDetails[] => {
    const rows = appliedDiffsByFile[filePath];
    if (!rows || rows.length === 0) return [];
    return rows.map(appliedDiffToWhy);
  };

  const acceptRegeneratedHunk = (): void => {
    if (!regenerate || !regenerate.suggestion) return;
    const file = parsedFiles.find((f) => f.path === regenerate.filePath);
    if (!file) {
      setRegenerate(null);
      return;
    }
    const baseModified = modifiedOverrides[file.path] ?? file.modified;
    const lines = baseModified.split('\n');
    const start = Math.max(0, regenerate.hunk.modifiedStartLine - 1);
    const endExclusive =
      regenerate.hunk.modifiedEndLine < regenerate.hunk.modifiedStartLine
        ? start
        : regenerate.hunk.modifiedEndLine;
    const before = lines.slice(0, start);
    const after = lines.slice(endExclusive);
    const replacement = regenerate.suggestion.split('\n');
    const nextText = [...before, ...replacement, ...after].join('\n');
    setModifiedOverrides((prev) => ({ ...prev, [file.path]: nextText }));
    setRegenerate(null);
  };

  useEffect(() => {
    if (parsedFiles.length === 0) return;
    const root = modalRootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (regenerate || showDraftPr || showConflicts) return;
      // Hand off j/k/a/r to the inner MonacoDiffViewer when the user is
      // focused there — per-hunk nav and accept/reject should win.
      const active = document.activeElement;
      const inDiffViewer = active instanceof HTMLElement && !!active.closest('.monaco-diff-viewer');
      if (e.shiftKey && (e.key === 'J' || e.key === 'K')) {
        e.preventDefault();
        if (e.key === 'J') {
          const next = Math.min(parsedFiles.length - 1, focusedIndex + 1);
          const nextPath = parsedFiles[next]?.path;
          if (nextPath) setFocusedPath(nextPath);
        } else {
          const prev = Math.max(0, focusedIndex - 1);
          const prevPath = parsedFiles[prev]?.path;
          if (prevPath) setFocusedPath(prevPath);
        }
        return;
      }
      if (e.shiftKey) return;
      if (inDiffViewer) return;
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
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [parsedFiles, focusedIndex, bundle, busy, regenerate, showDraftPr, showConflicts]);

  return (
    <div
      className="approval-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-review-modal-title"
      ref={modalRootRef}
    >
      <div
        className="approval-modal merge-review-modal"
        style={{ minWidth: 'min(960px, 92vw)', maxWidth: '96vw' }}
        tabIndex={-1}
      >
        <header className="approval-modal-header">
          <h2 id="merge-review-modal-title">Review subagent changes</h2>
        </header>

        {loadError && <p className="approvals-save-error">Failed to load diff: {loadError}</p>}

        {!bundle && !loadError && (
          <p className="approvals-loading" aria-busy="true">
            Loading diff…
          </p>
        )}

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
                    borderRadius: 'var(--radius-sm)',
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
                              ? '3px solid var(--accent)'
                              : '3px solid transparent',
                            transition:
                              'background var(--duration) var(--ease), border-color var(--duration-fast) var(--ease)',
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
                        modifiedText={modifiedOverrides[focusedFile.path] ?? focusedFile.modified}
                        language={focusedFile.language}
                        filePath={focusedFile.path}
                        height={400}
                        onAcceptHunk={(_idx, hunk) => {
                          setWhyOpenFor(hunk.index);
                        }}
                        onRejectHunk={(_idx, hunk) => {
                          openRegenerate(hunk);
                        }}
                      />
                      {whyOpenFor !== null && (
                        <details
                          open
                          style={{
                            padding: '8px 10px',
                            borderTop: '1px solid var(--border-row-divider)',
                            fontSize: 12,
                          }}
                        >
                          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            Why? · hunk #{whyOpenFor}
                          </summary>
                          <WhyDisclosureBody
                            provenance={provenanceFor(focusedFile.path)}
                            details={whyDetailsFor(focusedFile.path)}
                          />
                        </details>
                      )}
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
                  Merge changes
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!bundle || busy !== null}
                  onClick={() => setConfirm('reject')}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!bundle}
                  onClick={() => setShowDraftPr(true)}
                  title="Draft a pull request from this diff"
                >
                  Draft PR
                </button>
                {conflictError && (
                  <button
                    type="button"
                    className="btn btn-warn"
                    onClick={() => setShowConflicts(true)}
                  >
                    Resolve conflicts
                  </button>
                )}
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
              className="btn"
              disabled={busy !== null}
              onClick={onClose}
              style={{ marginLeft: 'auto' }}
            >
              Close
            </button>
          </div>
        </div>

        {regenerate && (
          <div
            style={{
              borderTop: '1px solid var(--border-strong)',
              padding: 12,
              background: 'var(--bg-elevated)',
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
              Regenerate hunk · {regenerate.filePath} · L{regenerate.hunk.modifiedStartLine}-
              {regenerate.hunk.modifiedEndLine}
            </h3>
            <div className="field">
              <textarea
                value={regenerate.instruction}
                onChange={(e) => setRegenerate({ ...regenerate, instruction: e.target.value })}
                rows={3}
                placeholder="Different instruction for this hunk…"
              />
            </div>
            {regenerate.error && <p className="approvals-save-error">{regenerate.error}</p>}
            {regenerate.suggestion !== null && (
              <pre
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: 'var(--radius-2xs)',
                  fontSize: 12,
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {regenerate.suggestion}
              </pre>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={regenerate.busy || !regenerate.instruction.trim()}
                onClick={() => void submitRegenerate()}
              >
                {regenerate.busy ? 'Generating…' : 'Regenerate'}
              </button>
              {regenerate.suggestion ? (
                <button
                  type="button"
                  className="btn"
                  onClick={acceptRegeneratedHunk}
                  title="Replace this hunk in the modal view (not written to disk)"
                >
                  Replace hunk
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => setRegenerate(null)}
                style={{ marginLeft: 'auto' }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {showDraftPr && bundle && (
        <DraftPrModal
          repoRoot={workspaceRoot}
          branch={bundle.branch}
          initialDiff={bundle.diff}
          onClose={() => setShowDraftPr(false)}
        />
      )}

      {showConflicts && (
        <MergeConflictResolver
          repoRoot={workspaceRoot}
          onClose={() => setShowConflicts(false)}
          onResolved={() => {
            setConflictError(null);
            setShowConflicts(false);
          }}
        />
      )}
    </div>
  );
}

function WhyDisclosureBody({
  provenance,
  details,
}: {
  provenance: HunkProvenance[];
  details: WhyDetails[];
}): JSX.Element {
  if (provenance.length === 0 && details.length === 0) {
    return (
      <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
        <em>No provenance recorded for this file yet.</em>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6, color: 'var(--text-muted)', display: 'grid', gap: 8 }}>
      {details.map((d, idx) => (
        <div
          key={`${d.appliedAt ?? 'na'}-${idx}`}
          style={{
            border: '1px solid var(--border-row-divider)',
            borderRadius: 'var(--radius-2xs)',
            padding: 8,
          }}
        >
          {d.promptSnapshot ? (
            <div style={{ marginBottom: 6 }}>
              <strong>User prompt</strong>
              <pre
                style={{
                  margin: '2px 0 0 0',
                  padding: 6,
                  background: 'var(--bg-sunken)',
                  borderRadius: 'var(--radius-2xs)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 11,
                }}
              >
                {d.promptSnapshot}
              </pre>
            </div>
          ) : null}
          {d.toolCallSummary ? (
            <div style={{ marginBottom: 4 }}>
              <strong>Tool call</strong> <code>{d.toolCallSummary}</code>
            </div>
          ) : null}
          {d.ragCitations.length > 0 ? (
            <div style={{ marginBottom: 4 }}>
              <strong>RAG context</strong>
              <ul style={{ margin: '2px 0 0 0', paddingLeft: 16 }}>
                {d.ragCitations.map((c, i) => (
                  <li key={`${c}-${i}`}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div style={{ fontSize: 11 }}>
            {d.providerId || d.modelId ? (
              <span>
                <strong>Model</strong> {d.providerId ?? '?'}/{d.modelId ?? '?'}
              </span>
            ) : null}
            {d.costUsd !== null ? (
              <span style={{ marginLeft: 8 }}>
                <strong>Cost</strong> ${d.costUsd.toFixed(6)}
              </span>
            ) : null}
            {d.tokensInput !== null || d.tokensOutput !== null ? (
              <span style={{ marginLeft: 8 }}>
                <strong>Tokens</strong> {d.tokensInput ?? 0} in / {d.tokensOutput ?? 0} out
              </span>
            ) : null}
            {d.appliedAt ? (
              <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                {new Date(d.appliedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
      ))}
      {provenance.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {provenance.map((p) => (
            <li key={p.toolCallId}>
              <strong>{p.toolName}</strong>
              {p.decision ? ` · ${p.decision}` : null}
              {p.rationale ? ` — ${p.rationale}` : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
