import { useEffect, useState } from 'react';

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

export function MergeReviewModal({
  runId,
  onClose,
  onResolved,
}: MergeReviewModalProps): JSX.Element {
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    }
  };

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div className="approval-modal merge-review-modal">
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

            {bundle.files.length > 0 && (
              <ul className="merge-review-file-list">
                {bundle.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            )}

            <pre className="merge-review-diff">{bundle.diff || '(empty diff)'}</pre>
          </>
        )}

        {actionError && <p className="approvals-save-error">{actionError}</p>}

        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button
              type="button"
              disabled={!bundle || busy !== null}
              onClick={() => void onAccept()}
            >
              {busy === 'accept' ? 'Merging…' : 'Accept (merge)'}
            </button>
            <button
              type="button"
              disabled={!bundle || busy !== null}
              onClick={() => void onReject()}
            >
              {busy === 'reject' ? 'Discarding…' : 'Reject (discard)'}
            </button>
            <button type="button" disabled={busy !== null} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
