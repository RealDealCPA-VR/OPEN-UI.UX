import { useEffect, useState } from 'react';
import { getBridge } from '../bridge';
import { Modal } from './Modal';

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
        const bridge = getBridge();
        if (!bridge) throw new Error('Preload bridge unavailable.');
        const res = await bridge.git.draftPr({
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
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.git.openPrInBrowser({
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
    <Modal
      open
      onClose={onClose}
      labelledBy="draft-pr-modal-title"
      className="approval-modal draft-pr-modal"
      closeOnBackdrop={!opening}
    >
      <div style={{ minWidth: 'min(720px, 92vw)', maxWidth: '92vw' }}>
        <header className="approval-modal-header">
          <h2 id="draft-pr-modal-title">Draft pull request</h2>
        </header>
        <p className="approval-modal-description">
          Branch <code>{branch}</code>{' '}
          {baseBranch ? (
            <>
              → <code>{baseBranch}</code>
            </>
          ) : null}
        </p>
        {generating && <p className="approvals-loading">Generating pull request draft…</p>}
        {error && <p className="approvals-save-error">{error}</p>}
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="field-label" htmlFor="draft-pr-title">
                Title
              </label>
              <input
                id="draft-pr-title"
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="draft-pr-body">
                Body
              </label>
              <textarea
                id="draft-pr-body"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={16}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
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
    </Modal>
  );
}
