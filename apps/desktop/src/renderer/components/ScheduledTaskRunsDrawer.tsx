import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduledTask, ScheduledTaskRun } from '../../shared/scheduled-tasks';
import type { AgentRun } from '../../shared/agent-runs';
import { AgentRunRow } from './AgentRunRow';
import { MergeReviewModal } from './MergeReviewModal';

export interface ScheduledTaskRunsDrawerProps {
  task: ScheduledTask;
  onClose: () => void;
}

const PAGE = 20;

export function ScheduledTaskRunsDrawer({
  task,
  onClose,
}: ScheduledTaskRunsDrawerProps): JSX.Element {
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [agentRunMap, setAgentRunMap] = useState<Record<string, AgentRun>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const hasInFlight = useMemo(() => runs.some((r) => r.status === 'running'), [runs]);

  useEffect(() => {
    if (!hasInFlight) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasInFlight]);

  const loadAgentRuns = useCallback((ids: readonly string[]): void => {
    if (ids.length === 0) return;
    window.opencodex.agent
      .listRuns()
      .then((all) => {
        const map: Record<string, AgentRun> = {};
        for (const r of all) {
          if (ids.includes(r.id)) map[r.id] = r;
        }
        setAgentRunMap((prev) => ({ ...prev, ...map }));
      })
      .catch(() => undefined);
  }, []);

  const loadFirst = useCallback((): void => {
    Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(null);
        return window.opencodex.scheduler.listRuns({ taskId: task.id, limit: PAGE });
      })
      .then((res) => {
        setRuns(res.runs);
        setCursor(res.nextCursor);
        setHasMore(res.nextCursor !== null);
        loadAgentRuns(res.runs.map((r) => r.agentRunId).filter((id): id is string => id !== null));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [task.id, loadAgentRuns]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const res = await window.opencodex.scheduler.listRuns({
        taskId: task.id,
        limit: PAGE,
        beforeId: cursor,
      });
      setRuns((prev) => [...prev, ...res.runs]);
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      await loadAgentRuns(
        res.runs.map((r) => r.agentRunId).filter((id): id is string => id !== null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cursor, task.id, loadAgentRuns]);

  useEffect(() => {
    loadFirst();
    const off = window.opencodex.scheduler.onRunCompleted((payload) => {
      if (payload.taskId === task.id) {
        loadFirst();
      }
    });
    return () => off();
  }, [task.id, loadFirst]);

  return (
    <aside className="agent-run-drawer scheduled-task-runs-drawer" aria-label="Run history">
      <header className="agent-run-drawer-header">
        <h3 className="agent-run-drawer-title">
          <span className="agent-run-drawer-title-label">History</span>
          <span className="agent-run-drawer-title-sep" aria-hidden="true">
            ·
          </span>
          <span className="agent-run-drawer-title-task">{task.name}</span>
        </h3>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      {error && <p className="approvals-save-error">{error}</p>}

      {runs.length === 0 && !loading && (
        <p className="audit-empty">
          No runs yet. Click <strong>Run now</strong> to test.
        </p>
      )}

      <ul className="audit-list">
        {runs.map((run) => {
          const agentRun = run.agentRunId ? agentRunMap[run.agentRunId] : undefined;
          return (
            <li key={run.id} className="audit-row">
              <div className="audit-row-head">
                <span className="audit-row-time">{run.startedAt}</span>
                <span
                  className={
                    run.status === 'completed'
                      ? 'pill pill-ok'
                      : run.status === 'failed'
                        ? 'pill pill-warn'
                        : 'pill'
                  }
                >
                  {run.status}
                </span>
                {run.wasCatchup && <span className="pill">catchup</span>}
                {run.errorMessage && <span className="audit-row-error">{run.errorMessage}</span>}
              </div>
              {agentRun && (
                <div className="audit-row-body">
                  <AgentRunRow
                    run={agentRun}
                    expanded={expandedId === agentRun.id}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === agentRun.id ? null : agentRun.id))
                    }
                    now={now}
                    onReview={(id) => setReviewRunId(id)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="scheduled-task-runs-loadmore">
          <button type="button" className="btn" disabled={loading} onClick={() => void loadMore()}>
            {loading ? (
              <>
                <span className="mcp-inline-spinner" aria-hidden="true" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}

      {reviewRunId && (
        <MergeReviewModal
          runId={reviewRunId}
          conversationId={reviewRunId}
          workspaceRoot={agentRunMap[reviewRunId]?.worktreeRepoRoot ?? task.workspacePath ?? '.'}
          onClose={() => setReviewRunId(null)}
          onResolved={() => void loadFirst()}
        />
      )}
    </aside>
  );
}
