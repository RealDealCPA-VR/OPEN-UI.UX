import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PluginListItem } from '../../shared/plugins';
import type { PluginPreset, RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';
import type {
  PackageManager,
  RunnerInstallProgress,
  RunnerInstallResult,
  RunnerProbeResult,
} from '../../shared/runner-discovery';

interface InstallStateMap {
  [runnerId: string]: RunnerInstallCheck | undefined;
}

interface PathStateMap {
  [runnerId: string]: string;
}

interface PickerState {
  managers: PackageManager[] | null;
  selected: PackageManager | null;
  loadError: string | null;
  loading: boolean;
}

interface InstallRunState {
  log: string;
  result: RunnerInstallResult | null;
  busy: boolean;
  showFullLog: boolean;
}

interface ProbeState {
  result: RunnerProbeResult | null;
  busy: boolean;
  testedAt: number | null;
}

const COMMAND_PREVIEW: Record<string, Partial<Record<PackageManager, string>>> = {
  'claude-code': { npm: 'npm install -g @anthropic-ai/claude-code' },
  opencode: { npm: 'npm install -g opencode' },
  aider: { pipx: 'pipx install aider-chat', homebrew: 'brew install aider' },
};

const MANAGER_LABEL: Record<PackageManager, string> = {
  npm: 'npm',
  homebrew: 'Homebrew',
  pipx: 'pipx',
  cargo: 'cargo',
};

const RUNNER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  internal: "OpenCodex's in-process agent loop — your provider, your tools, your approval policy.",
  'claude-code': "Anthropic's Claude Code CLI. Brings its own tools and approval flow.",
  opencode: 'The OpenCode harness. Multi-provider with file edits and shell access.',
  aider: 'Aider AI pair programmer. Strong at multi-file refactors with git-native edits.',
};

const CACHE_WINDOW_MS = 60_000;

interface RunnerBridge {
  getInstallablePackageManagers?: () => Promise<{ managers: PackageManager[] }>;
  install?: (req: {
    runnerId: string;
    packageManager: PackageManager;
  }) => Promise<RunnerInstallResult>;
  onInstallProgress?: (listener: (payload: RunnerInstallProgress) => void) => () => void;
  probeAuth?: (runnerId: string) => Promise<RunnerProbeResult>;
}

function runnerBridge(): RunnerBridge | null {
  const bridge = (window as unknown as { opencodex?: { runner?: RunnerBridge } }).opencodex;
  return bridge?.runner ?? null;
}

function describeRunner(runner: RunnerInfo): string {
  return RUNNER_DESCRIPTIONS[runner.id] ?? runner.displayName;
}

export function RunnersPanel(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runners, setRunners] = useState<RunnerInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<InstallStateMap>({});
  const [cliPaths, setCliPaths] = useState<PathStateMap>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [pickerStates, setPickerStates] = useState<Record<string, PickerState>>({});
  const [installRuns, setInstallRuns] = useState<Record<string, InstallRunState>>({});
  const [probeStates, setProbeStates] = useState<Record<string, ProbeState>>({});
  const [presets, setPresets] = useState<PluginPreset[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginListItem[]>([]);
  const [presetBusyId, setPresetBusyId] = useState<string | null>(null);
  const autoOpenedRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.plugins
      .listPresets()
      .then((p) => {
        if (!cancelled) setPresets(p);
      })
      .catch(() => {
        // Non-fatal — preset cards just don't render.
      });
    void window.opencodex.plugins
      .list()
      .then((r) => {
        if (!cancelled) setInstalledPlugins(r.plugins);
      })
      .catch(() => {
        // Non-fatal — without this we may show a preset that's already installed.
      });
    const off = window.opencodex.plugins.onChanged((evt) => {
      if (!cancelled) setInstalledPlugins(evt.plugins);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const installPreset = useCallback(async (presetId: string): Promise<void> => {
    setPresetBusyId(presetId);
    setActionError(null);
    try {
      const result = await window.opencodex.plugins.installPreset(presetId);
      setInstalledPlugins(result.plugins);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetBusyId(null);
    }
  }, []);

  const availableRunnerPresets = useMemo(() => {
    const installedNames = new Set(installedPlugins.map((p) => p.manifest.name));
    return presets.filter(
      (preset) => preset.id.startsWith('runner-') && !installedNames.has(preset.id),
    );
  }, [installedPlugins, presets]);

  const loadPickerManagers = useCallback(async (runnerId: string): Promise<void> => {
    const bridge = runnerBridge();
    if (!bridge?.getInstallablePackageManagers) {
      setPickerStates((prev) => ({
        ...prev,
        [runnerId]: {
          managers: [],
          selected: null,
          loadError: 'Install IPC not available yet.',
          loading: false,
        },
      }));
      return;
    }
    setPickerStates((prev) => ({
      ...prev,
      [runnerId]: { managers: null, selected: null, loadError: null, loading: true },
    }));
    try {
      const res = await bridge.getInstallablePackageManagers();
      const available = res.managers;
      const previewMap = COMMAND_PREVIEW[runnerId] ?? {};
      const filtered = available.filter((m) => previewMap[m] !== undefined);
      const ordered = filtered.length > 0 ? filtered : available;
      const firstSelected = ordered[0] ?? null;
      setPickerStates((prev) => ({
        ...prev,
        [runnerId]: {
          managers: ordered,
          selected: firstSelected,
          loadError: null,
          loading: false,
        },
      }));
    } catch (err) {
      setPickerStates((prev) => ({
        ...prev,
        [runnerId]: {
          managers: [],
          selected: null,
          loadError: err instanceof Error ? err.message : String(err),
          loading: false,
        },
      }));
    }
  }, []);

  const openPicker = useCallback(
    (runnerId: string) => {
      setPickerOpen(runnerId);
      if (!pickerStates[runnerId]) void loadPickerManagers(runnerId);
    },
    [pickerStates, loadPickerManagers],
  );

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!runners) return;
    const target = searchParams.get('install');
    if (!target) return;
    const match = runners.find((r) => r.id === target);
    if (!match) return;
    const status = installState[target];
    if (status?.ok) return;
    autoOpenedRef.current = true;
    openPicker(target);
    const next = new URLSearchParams(searchParams);
    next.delete('install');
    setSearchParams(next, { replace: true });
  }, [runners, installState, searchParams, setSearchParams, openPicker]);

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
        setSavedId(runnerId);
        window.setTimeout(() => {
          setSavedId((id) => (id === runnerId ? null : id));
        }, 1200);
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

  const handleInstall = useCallback(
    async (runnerId: string): Promise<void> => {
      const bridge = runnerBridge();
      const picker = pickerStates[runnerId];
      const manager = picker?.selected ?? null;
      if (!bridge?.install || !manager) return;
      setInstallRuns((prev) => ({
        ...prev,
        [runnerId]: { log: '', result: null, busy: true, showFullLog: false },
      }));
      let off: (() => void) | null = null;
      if (bridge.onInstallProgress) {
        off = bridge.onInstallProgress((payload) => {
          if (payload.runnerId !== runnerId) return;
          setInstallRuns((prev) => {
            const current = prev[runnerId];
            if (!current) return prev;
            return {
              ...prev,
              [runnerId]: { ...current, log: current.log + payload.chunk },
            };
          });
        });
      }
      try {
        const result = await bridge.install({ runnerId, packageManager: manager });
        setInstallRuns((prev) => {
          const current = prev[runnerId];
          if (!current) return prev;
          return { ...prev, [runnerId]: { ...current, result, busy: false } };
        });
        if (result.ok) {
          await recheckRunner(runnerId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInstallRuns((prev) => {
          const current = prev[runnerId] ?? {
            log: '',
            result: null,
            busy: false,
            showFullLog: false,
          };
          return {
            ...prev,
            [runnerId]: {
              ...current,
              busy: false,
              result: {
                ok: false,
                exitCode: -1,
                durationMs: 0,
                stderrTail: message,
              },
            },
          };
        });
      } finally {
        if (off) off();
      }
    },
    [pickerStates, recheckRunner],
  );

  const handleProbe = useCallback(async (runnerId: string): Promise<void> => {
    const bridge = runnerBridge();
    if (!bridge?.probeAuth) {
      setProbeStates((prev) => ({
        ...prev,
        [runnerId]: {
          result: {
            ok: false,
            authenticated: false,
            hint: 'Probe IPC not available yet.',
          },
          busy: false,
          testedAt: Date.now(),
        },
      }));
      return;
    }
    setProbeStates((prev) => ({
      ...prev,
      [runnerId]: {
        result: prev[runnerId]?.result ?? null,
        busy: true,
        testedAt: prev[runnerId]?.testedAt ?? null,
      },
    }));
    try {
      const result = await bridge.probeAuth(runnerId);
      setProbeStates((prev) => ({
        ...prev,
        [runnerId]: { result, busy: false, testedAt: Date.now() },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProbeStates((prev) => ({
        ...prev,
        [runnerId]: {
          result: { ok: false, authenticated: false, hint: message },
          busy: false,
          testedAt: Date.now(),
        },
      }));
    }
  }, []);

  const summary = useMemo(() => {
    if (!runners) return null;
    let total = 0;
    let installed = 0;
    let plugin = 0;
    for (const r of runners) {
      total += 1;
      if (r.source !== 'builtin') plugin += 1;
      const status = installState[r.id];
      if (r.source === 'builtin' || status?.ok) installed += 1;
    }
    return { total, installed, plugin };
  }, [runners, installState]);

  if (loadError) {
    return <p className="theme-error">Failed to load runners: {loadError}</p>;
  }
  if (runners === null) {
    return <p className="theme-loading">Loading…</p>;
  }

  const now = Date.now();

  return (
    <div className="runners-panel">
      {summary && (
        <div className="runners-summary" role="status">
          <span className="runners-summary-item">
            <strong>{summary.total}</strong> runner{summary.total === 1 ? '' : 's'}
          </span>
          <span className="runners-summary-item" style={{ color: 'var(--text-muted)' }}>
            ·
          </span>
          <span className="runners-summary-item">
            <strong>{summary.installed}</strong> ready
          </span>
          <span className="runners-summary-item" style={{ color: 'var(--text-muted)' }}>
            ·
          </span>
          <span className="runners-summary-item">
            <strong>{summary.plugin}</strong> external
          </span>
        </div>
      )}

      {runners.length === 0 ? (
        <p className="audit-empty">No runners registered.</p>
      ) : (
        <ul className="runners-list">
          {runners.map((runner) => {
            const status = installState[runner.id];
            const cliPath = cliPaths[runner.id] ?? '';
            const isBuiltin = runner.source === 'builtin';
            const sourceLabel = isBuiltin ? 'built-in' : (runner.pluginId ?? 'plugin');
            const picker = pickerStates[runner.id];
            const install = installRuns[runner.id];
            const probe = probeStates[runner.id];
            const isPickerOpen = pickerOpen === runner.id;
            const cached =
              probe?.testedAt !== null &&
              probe?.testedAt !== undefined &&
              now - probe.testedAt < CACHE_WINDOW_MS;
            const previewMap = COMMAND_PREVIEW[runner.id] ?? {};
            const selectedManager = picker?.selected ?? null;
            const commandPreview =
              selectedManager !== null ? (previewMap[selectedManager] ?? null) : null;
            const itemClass = isBuiltin
              ? 'runners-list-item is-builtin'
              : status?.ok
                ? 'runners-list-item is-installed'
                : 'runners-list-item is-missing';

            return (
              <li key={runner.id} className={itemClass}>
                <div className="runners-list-head">
                  <div className="runners-list-title">
                    <strong>{runner.displayName}</strong>
                    <span className="pill">{sourceLabel}</span>
                    {isBuiltin ? (
                      <span className="pill pill-ok">always ready</span>
                    ) : status ? (
                      status.ok ? (
                        <span className="pill pill-ok">
                          installed{status.version ? ` · ${status.version}` : ''}
                        </span>
                      ) : (
                        <span className="pill pill-warn" title={status.hint ?? 'Not installed'}>
                          not installed
                        </span>
                      )
                    ) : null}
                  </div>
                  <div className="runners-list-actions">
                    {!isBuiltin && status && !status.ok && (
                      <button
                        type="button"
                        className={isPickerOpen ? 'btn' : 'btn btn-primary'}
                        onClick={() => {
                          if (isPickerOpen) {
                            setPickerOpen(null);
                          } else {
                            openPicker(runner.id);
                          }
                        }}
                      >
                        {isPickerOpen ? 'Cancel' : 'Install'}
                      </button>
                    )}
                    {!isBuiltin && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleProbe(runner.id)}
                        disabled={probe?.busy}
                      >
                        {probe?.busy ? 'Testing…' : 'Test connection'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleRecheck(runner.id)}
                      disabled={recheckingId === runner.id}
                    >
                      {recheckingId === runner.id ? 'Checking…' : 'Re-check'}
                    </button>
                  </div>
                </div>

                <p className="runners-list-desc">{describeRunner(runner)}</p>

                {status && !status.ok && status.hint && (
                  <p className="settings-section-desc">{status.hint}</p>
                )}

                {probe?.result && (
                  <div
                    className={
                      probe.result.ok && probe.result.authenticated
                        ? 'runners-test-result is-ok'
                        : 'runners-test-result is-err'
                    }
                    role={probe.result.ok && probe.result.authenticated ? undefined : 'alert'}
                  >
                    <span>
                      {probe.result.ok && probe.result.authenticated
                        ? '✓ Ready'
                        : `✗ ${probe.result.hint ?? 'Not authenticated'}`}
                    </span>
                    {cached && <span className="runners-test-cached">cached</span>}
                    {!(probe.result.ok && probe.result.authenticated) && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleProbe(runner.id)}
                        disabled={probe.busy}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}

                {isPickerOpen && !isBuiltin && (
                  <div className="runners-install-panel">
                    <h4>Choose a package manager</h4>
                    {picker?.loading && (
                      <p className="settings-section-desc">Detecting available managers…</p>
                    )}
                    {picker?.loadError && (
                      <p className="approvals-save-error">{picker.loadError}</p>
                    )}
                    {picker?.managers && picker.managers.length === 0 && !picker.loadError && (
                      <p className="settings-section-desc">
                        No supported package manager detected on this host. Install npm, Homebrew,
                        pipx, or cargo, then retry.
                      </p>
                    )}
                    {picker?.managers && picker.managers.length > 0 && (
                      <div className="runners-pm-options">
                        {picker.managers.map((m) => {
                          const cmd = previewMap[m];
                          return (
                            <label key={m} className="runners-pm-option">
                              <input
                                type="radio"
                                name={`pm-${runner.id}`}
                                value={m}
                                checked={picker.selected === m}
                                onChange={() =>
                                  setPickerStates((prev) => ({
                                    ...prev,
                                    [runner.id]: { ...picker, selected: m },
                                  }))
                                }
                              />
                              <span>{MANAGER_LABEL[m]}</span>
                              {!cmd && (
                                <span className="runners-pm-preset-note">
                                  (no preset command for this runner)
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {commandPreview && (
                      <div>
                        <div className="runners-cmd-label">Command that will run:</div>
                        <pre className="runners-cmd-preview">{commandPreview}</pre>
                      </div>
                    )}
                    {install?.log && <pre className="runners-install-log">{install.log}</pre>}
                    {install?.result &&
                      (install.result.ok ? (
                        <span className="pill pill-ok" style={{ alignSelf: 'flex-start' }}>
                          Installed
                        </span>
                      ) : (
                        <div>
                          <span className="pill pill-warn" style={{ alignSelf: 'flex-start' }}>
                            Install failed (exit {install.result.exitCode})
                          </span>
                          {install.result.stderrTail && (
                            <details
                              style={{ marginTop: 6 }}
                              open={install.showFullLog}
                              onToggle={(e) =>
                                setInstallRuns((prev) => {
                                  const current = prev[runner.id];
                                  if (!current) return prev;
                                  return {
                                    ...prev,
                                    [runner.id]: {
                                      ...current,
                                      showFullLog: (e.target as HTMLDetailsElement).open,
                                    },
                                  };
                                })
                              }
                            >
                              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                                Show full log
                              </summary>
                              <pre className="runners-install-log" style={{ marginTop: 6 }}>
                                {install.result.stderrTail}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    <div className="runners-install-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          install?.busy ||
                          !selectedManager ||
                          picker?.managers === null ||
                          picker?.managers?.length === 0
                        }
                        onClick={() => void handleInstall(runner.id)}
                      >
                        {install?.busy ? 'Installing…' : 'Run install'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={install?.busy}
                        onClick={() => setPickerOpen(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {!isBuiltin && (
                  <label className="runners-cli-path-field">
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
                      {savedId === runner.id && (
                        <span aria-live="polite" className="runners-cli-saved">
                          Saved
                        </span>
                      )}
                    </div>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {actionError && <p className="approvals-save-error">{actionError}</p>}

      {availableRunnerPresets.length > 0 ? (
        <section className="runners-presets">
          <h3 className="runners-presets-head">Add another runner</h3>
          <p className="runners-presets-desc">
            Bundled runner plugins. Click Install to enable — no download required. You&apos;ll
            still need each runner&apos;s CLI on your machine (see install hint).
          </p>
          <ul className="runners-presets-list">
            {availableRunnerPresets.map((preset) => {
              const busy = presetBusyId === preset.id;
              return (
                <li key={preset.id} className="runners-preset-card">
                  <div className="runners-preset-card-body">
                    <strong>{preset.displayName}</strong>
                    <p>{preset.description}</p>
                    {preset.installHint && (
                      <p className="runners-preset-hint">{preset.installHint}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void installPreset(preset.id)}
                    disabled={busy}
                  >
                    {busy ? 'Installing…' : 'Install'}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="runners-presets-foot">
            Building your own? <a href="#/settings/plugins">Sideload a folder from Plugins</a>.
          </p>
        </section>
      ) : (
        <div className="runners-add-card">
          <div className="runners-add-card-body">
            <h3>All bundled runners installed</h3>
            <p>
              Want to add a custom runner? Sideload an unpacked plugin folder from the Plugins
              panel.
            </p>
          </div>
          <div className="runners-add-card-actions">
            <a className="btn" href="#/settings/plugins">
              Open Plugins
            </a>
            <a className="btn" href="#/settings/help">
              Read the manual
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
