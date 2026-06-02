import { useCallback, useEffect, useState } from 'react';
import type { MergeConflictHunk } from '../../shared/git-workflow';
import { getBridge } from '../bridge';

interface MergeConflictResolverProps {
  repoRoot: string;
  onClose: () => void;
  onResolved?: () => void;
}

export function MergeConflictResolver({
  repoRoot,
  onClose,
  onResolved,
}: MergeConflictResolverProps): JSX.Element {
  const [hunks, setHunks] = useState<MergeConflictHunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) {
      setError('Preload bridge unavailable.');
      setLoading(false);
      return;
    }
    try {
      const res = await bridge.git.listConflicts({ repoRoot });
      setHunks(res.hunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const resolve = async (
    hunk: MergeConflictHunk,
    decision: 'ours' | 'theirs' | 'both',
  ): Promise<void> => {
    setBusyIndex(hunk.index);
    setError(null);
    try {
      const bridge = getBridge();
      if (!bridge) throw new Error('Preload bridge unavailable.');
      const res = await bridge.git.resolveConflict({
        repoRoot,
        filePath: hunk.filePath,
        hunkIndex: hunk.index,
        decision,
      });
      if (!res.ok) {
        setError(res.error ?? 'failed to resolve');
      } else {
        await refresh();
        if (res.remainingHunks === 0 && onResolved) onResolved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div
        className="approval-modal merge-conflict-resolver"
        style={{ minWidth: 'min(820px, 92vw)', maxWidth: '92vw' }}
      >
        <header className="approval-modal-header">
          <h2>Resolve merge conflicts</h2>
        </header>
        {loading && <p>Loading conflicts…</p>}
        {error && <p className="approvals-save-error">{error}</p>}
        {!loading && hunks.length === 0 && <p>No conflicts found.</p>}
        {hunks.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
            {hunks.map((h) => (
              <li
                key={`${h.filePath}:${h.startLine}`}
                style={{
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  padding: 10,
                  background: 'var(--bg-sunken)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <code style={{ flex: 1, fontSize: 12 }}>
                    {h.filePath} · L{h.startLine}-{h.endLine}
                  </code>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      background: 'var(--bg-panel)',
                      border: '1px solid var(--success-border)',
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {h.ours || '(empty)'}
                  </pre>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      background: 'var(--bg-panel)',
                      border: '1px solid var(--accent-border)',
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}
                  >
                    {h.theirs || '(empty)'}
                  </pre>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyIndex !== null}
                    onClick={() => void resolve(h, 'ours')}
                  >
                    Accept left (ours)
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyIndex !== null}
                    onClick={() => void resolve(h, 'theirs')}
                  >
                    Accept right (theirs)
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyIndex !== null}
                    onClick={() => void resolve(h, 'both')}
                  >
                    Accept both
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button type="button" className="btn" onClick={onClose} style={{ marginLeft: 'auto' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
