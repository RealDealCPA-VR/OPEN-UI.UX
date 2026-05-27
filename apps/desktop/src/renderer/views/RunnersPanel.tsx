import { useCallback, useEffect, useState } from 'react';
import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';

interface InstallStateMap {
  [runnerId: string]: RunnerInstallCheck | undefined;
}

interface PathStateMap {
  [runnerId: string]: string;
}

export function RunnersPanel(): JSX.Element {
  const [runners, setRunners] = useState<RunnerInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<InstallStateMap>({});
  const [cliPaths, setCliPaths] = useState<PathStateMap>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  const recheckRunner = useCallback(async (runnerId: string): Promise<void> => {
    try {
      const status = await window.opencodex.agent.checkRunnerInstalled(runnerId);
      setInstallState((prev) => ({ ...prev, [runnerId]: status }));
    } catch {
      setInstallState((prev) => ({
        ...prev,
        [runnerId]: { ok: false, hint: 'Status check failed' },
      }));
    }
  }, []);

  const loadCliPath = useCallback(async (runnerId: string): Promise<void> => {
    try {
      const value = await window.opencodex.settings.getRunnerCliPath(runnerId);
      setCliPaths((prev) => ({ ...prev, [runnerId]: value ?? '' }));
    } catch {
      // leave at default empty
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchRunners = async (): Promise<void> => {
      try {
        const list = await window.opencodex.agent.listRunners();
        if (cancelled) return;
        setRunners(list);
        for (const r of list) {
          void recheckRunner(r.id);
          void loadCliPath(r.id);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    };
    void fetchRunners();
    const off = window.opencodex.agent.onRunnersChanged((payload) => {
      if (cancelled) return;
      setRunners(payload.runners);
      for (const r of payload.runners) {
        void recheckRunner(r.id);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [recheckRunner, loadCliPath]);

  const handleCliPathChange = useCallback((runnerId: string, value: string): void => {
    setCliPaths((prev) => ({ ...prev, [runnerId]: value }));
  }, []);

  const handleSaveCliPath = useCallback(
    async (runnerId: string): Promise<void> => {
      const value = (cliPaths[runnerId] ?? '').trim();
      setSavingId(runnerId);
      setActionError(null);
      try {
        await window.opencodex.settings.setRunnerCliPath(runnerId, value === '' ? null : value);
        await recheckRunner(runnerId);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingId(null);
      }
    },
    [cliPaths, recheckRunner],
  );

  const handleRecheck = useCallback(
    async (runnerId: string): Promise<void> => {
      setRecheckingId(runnerId);
      try {
        await recheckRunner(runnerId);
      } finally {
        setRecheckingId(null);
      }
    },
    [recheckRunner],
  );

  if (loadError) {
    return <p className="theme-error">Failed to load runners: {loadError}</p>;
  }
  if (runners === null) {
    return <p className="theme-loading">Loading…</p>;
  }

  return (
    <div className="runners-panel">
      <p className="settings-section-desc">
        Built-in runs OpenCodex&apos;s in-process agent loop. Plugin runners delegate to external
        CLI harnesses (Claude Code, Codex, OpenCode) — they use their own provider, tools, and
        approvals.
      </p>

      {runners.length === 0 ? (
        <p className="audit-empty">No runners registered.</p>
      ) : (
        <ul className="runners-list">
          {runners.map((runner) => {
            const status = installState[runner.id];
            const cliPath = cliPaths[runner.id] ?? '';
            const isBuiltin = runner.source === 'builtin';
            const sourceLabel = isBuiltin ? 'built-in' : (runner.pluginId ?? 'plugin');
            return (
              <li key={runner.id} className="runners-list-item">
                <div className="runners-list-head">
                  <div className="runners-list-title">
                    <strong>{runner.displayName}</strong>
                    <span className="pill">{sourceLabel}</span>
                    {status &&
                      (status.ok ? (
                        <span className="pill pill-ok">
                          installed{status.version ? ` · ${status.version}` : ''}
                        </span>
                      ) : (
                        <span className="pill pill-warn" title={status.hint ?? 'Not installed'}>
                          not installed
                        </span>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleRecheck(runner.id)}
                    disabled={recheckingId === runner.id}
                  >
                    {recheckingId === runner.id ? 'Checking…' : 'Re-check'}
                  </button>
                </div>
                {status && !status.ok && status.hint && (
                  <p className="settings-section-desc">{status.hint}</p>
                )}
                {!isBuiltin && (
                  <label className="agent-spawn-field">
                    <span>CLI path override (optional)</span>
                    <div className="runners-cli-path-row">
                      <input
                        type="text"
                        value={cliPath}
                        onChange={(e) => handleCliPathChange(runner.id, e.target.value)}
                        placeholder="/usr/local/bin/claude"
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={savingId === runner.id}
                        onClick={() => void handleSaveCliPath(runner.id)}
                      >
                        {savingId === runner.id ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {actionError && <p className="approvals-save-error">{actionError}</p>}

      <p className="settings-section-desc runners-guide-link">
        <a href="#/guides/runners">Read the runners guide</a>
      </p>
    </div>
  );
}
