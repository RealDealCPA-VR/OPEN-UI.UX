import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActiveRunCard } from '../components/ActiveRunCard';
import { AgentRunDrawer } from '../components/AgentRunDrawer';
import { AgentRunRow } from '../components/AgentRunRow';
import { AgentSpawnModal } from '../components/AgentSpawnModal';
import { HoverHint } from '../components/HoverHint';
import { MergeReviewModal } from '../components/MergeReviewModal';
import { consumeTransfer, onTransferPushed } from '../state/transfer';
import { partitionRunsByActivity } from './agent-runs-derive';
import type { AgentRun } from '../../shared/agent-runs';

export function AgentView(): JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ runId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const drawerRunId = params.runId ?? null;

  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [clearing, setClearing] = useState(false);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnInitialTask, setSpawnInitialTask] = useState<string>('');
  const [spawnInitialWorkspace, setSpawnInitialWorkspace] = useState<string | undefined>(undefined);

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
        if (!cancelled) setRuns(initial);
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

  useEffect(() => {
    if (!runs) return;
    const anyRunning = runs.some((r) => r.status === 'running');
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runs]);

  // Handle inbound chat-to-agent transfers: pre-open the spawn modal.
  useEffect(() => {
    return onTransferPushed((ctx) => {
      if (ctx.kind !== 'chat-to-agent') return;
      consumeTransfer();
      setSpawnInitialTask(ctx.lastUserMessage);
      setSpawnInitialWorkspace(ctx.workspaceRoot);
      setSpawnOpen(true);
    });
  }, []);

  // Honor ?spawn=1 from left-column empty-state CTA.
  useEffect(() => {
    if (searchParams.get('spawn') !== '1') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpawnOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('spawn');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onClear = useCallback(async () => {
    setClearing(true);
    try {
      const next = await window.opencodex.agent.clearRuns();
      setRuns(next);
      setExpandedId(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }, []);

  const openRun = useCallback(
    (runId: string) => {
      navigate(`/agent/${runId}`);
    },
    [navigate],
  );

  const closeRun = useCallback(() => {
    navigate('/agent');
  }, [navigate]);

  const onSpawned = useCallback(
    (runId: string) => {
      setSpawnOpen(false);
      setSpawnInitialTask('');
      setSpawnInitialWorkspace(undefined);
      openRun(runId);
      void refresh();
    },
    [openRun, refresh],
  );

  const drawerRun = drawerRunId && runs ? (runs.find((r) => r.id === drawerRunId) ?? null) : null;
  const partition = runs ? partitionRunsByActivity(runs) : { active: [], history: [] };

  return (
    <section className="view agent-view">
      <header className="agent-view-header">
        <div>
          <h1>Agent</h1>
          <p>
            Active subagent runs and history. Spawn a new task here or via the{' '}
            <code>spawn_subagent</code> tool from chat.
          </p>
        </div>
        <HoverHint hint="Spawn new task">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSpawnInitialTask('');
              setSpawnInitialWorkspace(undefined);
              setSpawnOpen(true);
            }}
          >
            + Spawn task
          </button>
        </HoverHint>
      </header>

      {loadError && <p className="approvals-save-error">Failed to load runs: {loadError}</p>}

      {partition.active.length > 0 && (
        <section className="agent-view-active">
          <h2 className="agent-view-section-head">Active ({partition.active.length})</h2>
          <div className="agent-view-active-grid">
            {partition.active.map((run) => (
              <ActiveRunCard key={run.id} run={run} now={now} onSelect={() => openRun(run.id)} />
            ))}
          </div>
        </section>
      )}

      <section className="agent-view-history">
        <div className="agent-view-toolbar">
          <h2 className="agent-view-section-head">History ({partition.history.length})</h2>
          <button
            type="button"
            className="audit-clear-button"
            disabled={clearing || partition.history.length === 0}
            onClick={() => {
              void onClear();
            }}
          >
            {clearing ? 'Clearing…' : 'Clear history'}
          </button>
        </div>

        {runs && partition.active.length === 0 && partition.history.length === 0 && !loadError && (
          <p className="audit-empty">
            No subagent runs yet. Click <strong>Spawn task</strong> above, or call{' '}
            <code>spawn_subagent</code> from chat.
          </p>
        )}

        {partition.history.length > 0 && (
          <ul className="audit-list">
            {partition.history.map((run) => (
              <AgentRunRow
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                onToggle={() => {
                  if (expandedId === run.id) {
                    setExpandedId(null);
                  } else {
                    setExpandedId(run.id);
                    openRun(run.id);
                  }
                }}
                now={now}
                onReview={(id) => setReviewRunId(id)}
                onContinueInChat={() => navigate('/chat')}
              />
            ))}
          </ul>
        )}
      </section>

      {drawerRun && (
        <AgentRunDrawer
          run={drawerRun}
          now={now}
          onClose={closeRun}
          onOpenMergeReview={(id) => setReviewRunId(id)}
          onContinueInChat={() => navigate('/chat')}
        />
      )}

      {reviewRunId && (
        <MergeReviewModal
          runId={reviewRunId}
          onClose={() => setReviewRunId(null)}
          onResolved={() => {
            void refresh();
          }}
        />
      )}

      {spawnOpen && (
        <AgentSpawnModal
          initialTask={spawnInitialTask}
          {...(spawnInitialWorkspace ? { initialWorkspaceRoot: spawnInitialWorkspace } : {})}
          onClose={() => setSpawnOpen(false)}
          onSpawned={onSpawned}
        />
      )}
    </section>
  );
}
