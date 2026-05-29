import { useEffect, useState } from 'react';

interface DraftPrModalProps {
  repoRoot: string;
  branch: string;
  conversationId?: string;
  runId?: string;
  initialDiff?: string;
  baseBranch?: string;
  onClose: () => void;
}

interface DraftState {
  title: string;
  body: string;
}

export function DraftPrModal({
  repoRoot,
  branch,
  conversationId,
  runId,
  initialDiff,
  baseBranch,
  onClose,
}: DraftPrModalProps): JSX.Element {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [generating, setGenerating] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.opencodex.git.draftPr({
          repoRoot,
          branch,
          ...(baseBranch ? { baseBranch } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(runId ? { runId } : {}),
          ...(initialDiff ? { diff: initialDiff } : {}),
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error ?? 'failed to draft PR');
          return;
        }
        setDraft({ title: res.title ?? 'Draft PR', body: res.body ?? '' });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoRoot, branch, conversationId, runId, initialDiff, baseBranch]);

  const onOpen = async (): Promise<void> => {
    if (!draft) return;
    setOpening(true);
    setError(null);
    try {
      const res = await window.opencodex.git.openPrInBrowser({
        repoRoot,
        branch,
        ...(baseBranch ? { baseBranch } : {}),
        title: draft.title,
        body: draft.body,
      });
      if (!res.ok) {
        setError(res.error ?? 'failed to open browser');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div
        className="approval-modal draft-pr-modal"
        style={{ minWidth: 'min(720px, 92vw)', maxWidth: '92vw' }}
      >
        <header className="approval-modal-header">
          <h2>Draft pull request</h2>
        </header>
        <p className="approval-modal-description">
          Branch <code>{branch}</code>{' '}
          {baseBranch ? (
            <>
              → <code>{baseBranch}</code>
            </>
          ) : null}
        </p>
        {generating && <p>Drafting with provider…</p>}
        {error && <p className="approvals-save-error">{error}</p>}
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Title</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                style={{
                  padding: '6px 8px',
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Body</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={16}
                style={{
                  padding: '8px',
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 13,
                }}
              />
            </label>
          </div>
        )}
        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!draft || opening}
              onClick={() => void onOpen()}
            >
              {opening ? 'Opening…' : 'Open in browser'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={opening}
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
