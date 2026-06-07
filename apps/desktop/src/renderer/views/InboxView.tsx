import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgentRunRow } from '../components/AgentRunRow';
import { MergeReviewModal } from '../components/MergeReviewModal';
import { deriveInbox } from './agent-runs-derive';
import type { AgentRun } from '../../shared/agent-runs';

export function InboxView(): JSX.Element {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [now] = useState<number>(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await window.opencodex.agent.listRuns();
      setRuns(next);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await window.opencodex.agent.listRuns();
        if (cancelled) return;
        setRuns(initial);
        const unseenIds = initial.filter((r) => r.status !== 'running' && !r.seen).map((r) => r.id);
        if (unseenIds.length > 0) {
          const res = await window.opencodex.agent.markRunsSeen(unseenIds);
          if (!cancelled) setRuns(res.runs);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setRuns([]);
        }
      }
    })();
    const off = window.opencodex.agent.onRunsChanged((payload) => {
      setRuns(payload.runs);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const inbox = useMemo(() => (runs ? deriveInbox(runs) : null), [runs]);

  const renderRow = (run: AgentRun): JSX.Element => (
    <AgentRunRow
      key={run.id}
      run={run}
      expanded={expandedId === run.id}
      onToggle={() => setExpandedId((prev) => (prev === run.id ? null : run.id))}
      now={now}
      onReview={(id) => setReviewRunId(id)}
      onContinueInChat={() => navigate('/chat')}
    />
  );

  return (
    <section className="view inbox-view">
      <header className="agent-view-header">
        <div>
          <h1>Inbox</h1>
          <p>Finished agent runs. Review pending changes or revisit completed work.</p>
        </div>
      </header>

      {loadError && <p className="approvals-save-error">Failed to load runs: {loadError}</p>}

      {inbox && (
        <>
          <section className="agent-view-history">
            <h2 className="agent-view-section-head">Needs review ({inbox.needsReview.length})</h2>
            {inbox.needsReview.length > 0 ? (
              <ul className="audit-list">{inbox.needsReview.map(renderRow)}</ul>
            ) : (
              <p className="audit-empty">Nothing waiting on you.</p>
            )}
          </section>

          <section className="agent-view-history">
            <h2 className="agent-view-section-head">Done ({inbox.done.length})</h2>
            {inbox.done.length > 0 ? (
              <ul className="audit-list">{inbox.done.map(renderRow)}</ul>
            ) : (
              <p className="audit-empty">No finished runs yet.</p>
            )}
          </section>
        </>
      )}

      {reviewRunId && (
        <MergeReviewModal
          runId={reviewRunId}
          conversationId={reviewRunId}
          workspaceRoot={runs?.find((r) => r.id === reviewRunId)?.worktreeRepoRoot ?? '.'}
          onClose={() => setReviewRunId(null)}
          onResolved={() => {
            void refresh();
          }}
        />
      )}
    </section>
  );
}
