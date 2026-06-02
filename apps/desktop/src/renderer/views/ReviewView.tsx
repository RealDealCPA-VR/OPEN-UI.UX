import { useCallback, useMemo, useState } from 'react';
import { ReviewFindingCard } from '../components/ReviewFindingCard';
import { ReviewSourcePicker } from '../components/ReviewSourcePicker';
import { useSelectedModel } from '../state/selected-model-context';
import type { ReviewDiff, ReviewFinding, ReviewSeverity, ReviewSource } from '../../shared/review';

type Stage = 'idle' | 'fetching' | 'fetched' | 'analyzing' | 'analyzed' | 'error';

const SEVERITY_ORDER: ReviewSeverity[] = ['bug', 'smell', 'style', 'nit'];

export function ReviewView(): JSX.Element {
  const { selected } = useSelectedModel();
  const [stage, setStage] = useState<Stage>('idle');
  const [diff, setDiff] = useState<ReviewDiff | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [warning, setWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [extraContext, setExtraContext] = useState<string>('');
  const [postConfirmAll, setPostConfirmAll] = useState(false);
  const [postBusy, setPostBusy] = useState(false);
  const [postLog, setPostLog] = useState<string[]>([]);

  const fetchDiff = useCallback(async (source: ReviewSource) => {
    setStage('fetching');
    setErrorMsg(null);
    setWarning(null);
    setFindings([]);
    setSelectedIds(new Set());
    try {
      const res = await window.opencodex.review.fetchDiff({ source });
      setDiff(res.diff);
      setStage('fetched');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }, []);

  const generate = useCallback(async () => {
    if (!diff || !selected) return;
    setStage('analyzing');
    setErrorMsg(null);
    try {
      const res = await window.opencodex.review.generateFindings({
        diff,
        providerId: selected.providerId,
        modelId: selected.modelId,
        ...(extraContext.trim().length > 0 ? { extraContext: extraContext.trim() } : {}),
      });
      setFindings(res.findings);
      setWarning(res.warning);
      setSelectedIds(new Set(res.findings.map((f) => f.id)));
      setStage('analyzed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }, [diff, selected, extraContext]);

  const sortedFindings = useMemo<ReviewFinding[]>(() => {
    return [...findings].sort((a, b) => {
      const sa = SEVERITY_ORDER.indexOf(a.severity);
      const sb = SEVERITY_ORDER.indexOf(b.severity);
      if (sa !== sb) return sa - sb;
      return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine;
    });
  }, [findings]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openInCodebase = useCallback((path: string) => {
    window.location.hash = `#/codebase?path=${encodeURIComponent(path)}`;
  }, []);

  const copyPrompt = useCallback(async (finding: ReviewFinding) => {
    if (!finding.prompt) return;
    try {
      await navigator.clipboard.writeText(finding.prompt);
    } catch {
      // clipboard unavailable — surface nothing to avoid noisy UI for an optional action
    }
  }, []);

  const onPostSelected = useCallback(async () => {
    if (!diff || diff.prNumber === null) return;
    const selectedFindings = findings.filter((f) => selectedIds.has(f.id));
    if (selectedFindings.length === 0) return;
    setPostBusy(true);
    try {
      const res = await window.opencodex.review.postComments({
        prNumber: diff.prNumber,
        findings: selectedFindings,
        perFindingMode: true,
      });
      setPostLog((prev) => [
        ...prev,
        `Posted ${res.postedCount}/${selectedFindings.length} selected finding(s)`,
        ...res.errors.map((e) => `Failed: ${e.message ?? 'unknown error'}`),
      ]);
    } catch (err) {
      setPostLog((prev) => [
        ...prev,
        `Failed to post selection — ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setPostBusy(false);
      setPostConfirmAll(false);
    }
  }, [diff, findings, selectedIds]);

  const canPostToPr = diff !== null && diff.prNumber !== null;

  return (
    <div
      className="review-view"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 380px) 1fr',
        gap: 16,
        padding: 16,
        minHeight: 0,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 12,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 8px)',
          overflowY: 'auto',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 16 }}>Reviewer</h1>
        <ReviewSourcePicker disabled={stage === 'fetching'} onSubmit={fetchDiff} />

        {diff && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Diff</h3>
            <div style={{ fontSize: 12 }}>
              {diff.baseRef && diff.headRef && (
                <div>
                  Range:{' '}
                  <code>
                    {diff.baseRef}...{diff.headRef}
                  </code>
                </div>
              )}
              {diff.prNumber !== null && (
                <div>
                  PR: <code>#{diff.prNumber}</code>
                </div>
              )}
              <div>Files: {diff.files.length}</div>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Extra context (optional)
              </span>
              <textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                rows={3}
                placeholder="Focus on auth boundaries, recent regressions, etc."
                style={{ fontFamily: 'inherit', fontSize: 12 }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void generate()}
              disabled={!selected || stage === 'analyzing'}
            >
              {stage === 'analyzing' ? 'Analyzing…' : 'Generate findings'}
            </button>
            {!selected && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--warn, var(--text-secondary))' }}>
                Select a model in the chat picker first.
              </p>
            )}
          </section>
        )}

        {postLog.length > 0 && (
          <section>
            <h3 style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Post log
            </h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
              {postLog.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 12,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 8px)',
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {errorMsg && (
          <p style={{ color: 'var(--danger)', margin: 0 }} role="alert">
            {errorMsg}
          </p>
        )}
        {warning && (
          <p style={{ color: 'var(--warn)', margin: 0 }} role="status">
            {warning}
          </p>
        )}

        {stage === 'idle' && (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Pick a source on the left to begin a review.
          </p>
        )}

        {stage === 'fetching' && <p style={{ margin: 0 }}>Fetching diff…</p>}

        {stage === 'fetched' && diff && findings.length === 0 && (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Diff loaded — click <strong>Generate findings</strong> to analyze.
          </p>
        )}

        {sortedFindings.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>
                {sortedFindings.length} finding{sortedFindings.length === 1 ? '' : 's'} ·{' '}
                {selectedIds.size} selected
              </span>
              {canPostToPr && (
                <button
                  type="button"
                  className="btn"
                  disabled={selectedIds.size === 0 || postBusy}
                  onClick={() => setPostConfirmAll(true)}
                  style={{ marginLeft: 'auto' }}
                >
                  Post selected as PR comments…
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sortedFindings.map((f) => (
                <ReviewFindingCard
                  key={f.id}
                  finding={f}
                  selected={selectedIds.has(f.id)}
                  onToggleSelected={() => toggleSelected(f.id)}
                  onOpenInCodebase={() => openInCodebase(f.filePath)}
                  onCopyPrompt={() => void copyPrompt(f)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {postConfirmAll && (
        <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
          <div className="approval-modal" style={{ minWidth: 'min(520px, 92vw)' }}>
            <header className="approval-modal-header">
              <h2>
                Post {selectedIds.size} comment(s) to PR #{diff?.prNumber}
              </h2>
            </header>
            <p className="approval-modal-description">
              Confirm posting all {selectedIds.size} selected finding(s) via{' '}
              <code>gh pr comment</code>, one comment per finding.
            </p>
            <div className="approval-modal-actions">
              <div className="approval-modal-action-group">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={postBusy}
                  onClick={() => void onPostSelected()}
                >
                  {postBusy ? 'Posting…' : `Post ${selectedIds.size} comment(s)`}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={postBusy}
                  onClick={() => setPostConfirmAll(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
