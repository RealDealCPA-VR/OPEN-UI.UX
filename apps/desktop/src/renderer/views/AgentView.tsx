import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActiveRunCard } from '../components/ActiveRunCard';
import { AgentRunDrawer } from '../components/AgentRunDrawer';
import { AgentRunRow } from '../components/AgentRunRow';
import { AgentSpawnModal } from '../components/AgentSpawnModal';
import { AgentTreeView } from '../components/AgentTreeView';
import { FanoutConsentModal, useFanoutConsent } from '../components/FanoutConsentModal';
import { HoverHint } from '../components/HoverHint';
import { MergeReviewModal } from '../components/MergeReviewModal';
import { RunnerDiscoveryCards } from '../components/RunnerDiscoveryCards';
import { consumeTransfer, onTransferPushed } from '../state/transfer';
import { partitionRunsByActivity } from './agent-runs-derive';
import type { AgentRun } from '../../shared/agent-runs';
import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';

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
  const [spawnInitialRunnerId, setSpawnInitialRunnerId] = useState<string | undefined>(undefined);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [installStatuses, setInstallStatuses] = useState<Map<string, RunnerInstallCheck>>(
    () => new Map(),
  );
  // Lane 17 — list/tree mode toggle + fanout consent host
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const fanout = useFanoutConsent();

  const refreshRunners = useCallback(async () => {
    try {
      const list = await window.opencodex.agent.listRunners();
      setRunners(list);
      const entries = await Promise.all(
        list.map(async (r) => {
          try {
            const status = await window.opencodex.agent.checkRunnerInstalled(r.id);
            return [r.id, status] as const;
          } catch {
            return [
              r.id,
              { ok: false, hint: 'Status check failed' } as RunnerInstallCheck,
            ] as const;
          }
        }),
      );
      setInstallStatuses(new Map(entries));
    } catch {
      // Non-fatal — empty state still works without runner data.
    }
  }, []);

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
    // refreshRunners is async; setState happens in the awaited continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRunners();
    const off = window.opencodex.agent.onRunnersChanged(() => {
      void refreshRunners();
    });
    return () => {
      off();
    };
  }, [refreshRunners]);

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
      if (ctx.kind === 'chat-to-agent') {
        consumeTransfer();
        setSpawnInitialTask(ctx.lastUserMessage);
        setSpawnInitialWorkspace(ctx.workspaceRoot);
        setSpawnOpen(true);
        return;
      }
      if (ctx.kind === 'codebase-to-agent') {
        consumeTransfer();
        const firstRunId = ctx.runIds[0];
        if (firstRunId && runs && runs.some((r) => r.id === firstRunId)) {
          navigate(`/agent/${firstRunId}`);
          return;
        }
        setSpawnInitialTask(`Re: ${ctx.filePath}\n\n`);
        setSpawnInitialWorkspace(undefined);
        setSpawnOpen(true);
      }
    });
  }, [navigate, runs]);

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
      setSpawnInitialRunnerId(undefined);
      openRun(runId);
      void refresh();
    },
    [openRun, refresh],
  );

  const handleDiscoverySpawn = useCallback((runnerId: string) => {
    setSpawnInitialTask('');
    setSpawnInitialWorkspace(undefined);
    setSpawnInitialRunnerId(runnerId);
    setSpawnOpen(true);
  }, []);

  const handleDiscoverySetup = useCallback(
    (runnerId: string) => {
      navigate(`/runners?install=${runnerId}`);
    },
    [navigate],
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
        <div
          role="tablist"
          aria-label="View mode"
          style={{ display: 'inline-flex', gap: 4, marginRight: 8 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'list'}
            className={viewMode === 'list' ? 'btn btn-primary' : 'btn'}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'tree'}
            className={viewMode === 'tree' ? 'btn btn-primary' : 'btn'}
            onClick={() => setViewMode('tree')}
          >
            Tree
          </button>
        </div>
        <HoverHint hint="Spawn new task">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSpawnInitialTask('');
              setSpawnInitialWorkspace(undefined);
              setSpawnInitialRunnerId(undefined);
              setSpawnOpen(true);
            }}
          >
            + Spawn task
          </button>
        </HoverHint>
      </header>

      {viewMode === 'tree' && runs && (
        <section className="agent-view-tree">
          <h2 className="agent-view-section-head">Run tree</h2>
          <AgentTreeView runs={runs} now={now} onSelectRun={openRun} />
        </section>
      )}

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
          <div className="agent-view-empty">
            <p className="audit-empty" style={{ marginBottom: 4 }}>
              No runs yet. Pick a runner to get started.
            </p>
            <p className="settings-section-desc" style={{ marginTop: 0, marginBottom: 12 }}>
              Or call <code>spawn_subagent</code> from chat.
            </p>
            <RunnerDiscoveryCards
              runners={runners}
              installStatuses={installStatuses}
              onSpawn={handleDiscoverySpawn}
              onSetup={handleDiscoverySetup}
            />
          </div>
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
          conversationId={reviewRunId}
          workspaceRoot={runs?.find((r) => r.id === reviewRunId)?.worktreeRepoRoot ?? '.'}
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
          {...(spawnInitialRunnerId ? { initialRunnerId: spawnInitialRunnerId } : {})}
          onClose={() => {
            setSpawnOpen(false);
            setSpawnInitialRunnerId(undefined);
          }}
          onSpawned={onSpawned}
        />
      )}

      {fanout.current && (
        <FanoutConsentModal request={fanout.current} onResolved={() => fanout.clear()} />
      )}
    </section>
  );
}
