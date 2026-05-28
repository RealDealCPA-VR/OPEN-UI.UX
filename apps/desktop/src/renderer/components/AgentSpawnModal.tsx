import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';
import { useSelectedModel } from '../state/selected-model-context';

export interface AgentSpawnModalProps {
  initialTask?: string;
  initialWorkspaceRoot?: string;
  onClose: () => void;
  onSpawned: (runId: string) => void;
}

interface InstallStateMap {
  [runnerId: string]: RunnerInstallCheck | undefined;
}

export function AgentSpawnModal({
  initialTask = '',
  initialWorkspaceRoot,
  onClose,
  onSpawned,
}: AgentSpawnModalProps): JSX.Element {
  const { configuredProviders, selected } = useSelectedModel();
  const [task, setTask] = useState(initialTask);
  const [providerId, setProviderId] = useState<string>(
    selected?.providerId ?? configuredProviders[0]?.info.id ?? '',
  );
  const [modelId, setModelId] = useState<string>(selected?.modelId ?? '');
  const [workspaceRoot, setWorkspaceRoot] = useState<string>(initialWorkspaceRoot ?? '');
  const [lastInitialWorkspaceRoot, setLastInitialWorkspaceRoot] = useState<string | undefined>(
    initialWorkspaceRoot,
  );
  const [useWorktree, setUseWorktree] = useState<boolean>(false);
  const [isRepoState, setIsRepoState] = useState<{ root: string; isRepo: boolean | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [runnerId, setRunnerId] = useState<string>('internal');
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [installState, setInstallState] = useState<InstallStateMap>({});

  if (initialWorkspaceRoot !== lastInitialWorkspaceRoot) {
    setLastInitialWorkspaceRoot(initialWorkspaceRoot);
    if (initialWorkspaceRoot) setWorkspaceRoot(initialWorkspaceRoot);
  }

  useEffect(() => {
    if (initialWorkspaceRoot) return;
    if (workspaceRoot) return;
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled && s.active) setWorkspaceRoot(s.active);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialWorkspaceRoot, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    let cancelled = false;
    const root = workspaceRoot;
    void window.opencodex.git
      .isRepo(root)
      .then((r) => {
        if (!cancelled) setIsRepoState({ root, isRepo: r.isRepo });
      })
      .catch(() => {
        if (!cancelled) setIsRepoState({ root, isRepo: false });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    const fetchAndCheck = async (): Promise<void> => {
      try {
        const list = await window.opencodex.agent.listRunners();
        if (cancelled) return;
        setRunners(list);
        for (const r of list) {
          if (r.source === 'builtin') continue;
          void window.opencodex.agent
            .checkRunnerInstalled(r.id)
            .then((status) => {
              if (cancelled) return;
              setInstallState((prev) => ({ ...prev, [r.id]: status }));
            })
            .catch(() => undefined);
        }
      } catch {
        // leave runners empty; selector will fall back to internal
      }
    };
    void fetchAndCheck();
    const off = window.opencodex.agent.onRunnersChanged(() => {
      void fetchAndCheck();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const isRepo: boolean | null =
    isRepoState && isRepoState.root === workspaceRoot ? isRepoState.isRepo : null;

  const providerOptions = useMemo(
    () =>
      configuredProviders.map((p) => ({
        id: p.info.id,
        displayName: p.info.displayName,
        models: p.info.models.filter((m) => !m.embeddings),
      })),
    [configuredProviders],
  );

  const modelOptions = useMemo(() => {
    const provider = providerOptions.find((p) => p.id === providerId);
    return provider?.models ?? [];
  }, [providerOptions, providerId]);

  const effectiveModelId =
    modelId && modelOptions.some((m) => m.id === modelId) ? modelId : (modelOptions[0]?.id ?? '');

  const isExternalRunner = runnerId !== 'internal';
  const effectiveUseWorktree = isExternalRunner ? true : useWorktree && isRepo === true;

  const handleBrowse = useCallback(async () => {
    try {
      const next = await window.opencodex.workspace.browse();
      if (next.active) setWorkspaceRoot(next.active);
    } catch {
      // dialog cancelled
    }
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    const nextFieldErrors: Record<string, string> = {};
    if (!task.trim()) nextFieldErrors.task = 'Task description is required.';
    if (!workspaceRoot) nextFieldErrors.workspace = 'Choose a workspace folder.';
    if (!isExternalRunner) {
      if (!providerId) nextFieldErrors.provider = 'Select a provider.';
      if (!effectiveModelId) nextFieldErrors.model = 'Select a model.';
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await window.opencodex.agent.spawnFromUi({
        task: task.trim(),
        providerId,
        modelId: effectiveModelId,
        workspaceRoot,
        useWorktree: effectiveUseWorktree,
        runnerId,
      });
      onSpawned(res.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    task,
    providerId,
    effectiveModelId,
    workspaceRoot,
    effectiveUseWorktree,
    isExternalRunner,
    runnerId,
    onSpawned,
  ]);

  const canSubmit =
    !busy &&
    task.trim().length > 0 &&
    workspaceRoot !== '' &&
    (isExternalRunner || (providerId !== '' && effectiveModelId !== ''));

  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) void submit();
    }
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      onClose();
    }
  };

  const selectedRunner = runners.find((r) => r.id === runnerId);
  const selectedRunnerStatus = selectedRunner ? installState[selectedRunner.id] : undefined;
  const selectedRunnerInstalled =
    selectedRunner === undefined ||
    selectedRunner.source === 'builtin' ||
    (selectedRunnerStatus !== undefined && selectedRunnerStatus.ok);

  const showWorktreePreview = effectiveUseWorktree && workspaceRoot;
  const branchPrefix = 'opencodex/subagent/';
  const previewSeparator = workspaceRoot.includes('\\') ? '\\' : '/';
  const worktreeRoot = workspaceRoot
    ? `${workspaceRoot}${previewSeparator}.opencodex${previewSeparator}worktrees`
    : '';

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
      <div className="approval-modal agent-spawn-modal">
        <header className="approval-modal-header">
          <h2>Spawn task</h2>
        </header>

        <label className="agent-spawn-field">
          <span>Task description</span>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={5}
            placeholder="What should the subagent do? Be specific."
            autoFocus
            style={fieldErrors.task ? { borderColor: 'var(--danger-border)' } : undefined}
          />
          {fieldErrors.task && (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>{fieldErrors.task}</span>
          )}
        </label>

        <label className="agent-spawn-field">
          <span>Runner</span>
          <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)}>
            {runners.length === 0 ? (
              <option value="internal">Built-in (internal)</option>
            ) : (
              runners.map((r) => {
                const sourceBadge = r.source === 'builtin' ? 'built-in' : (r.pluginId ?? 'plugin');
                const status = installState[r.id];
                const disabled = r.source !== 'builtin' && status !== undefined && !status.ok;
                const hint = disabled ? (status?.hint ?? 'Not installed') : undefined;
                const inlineSuffix =
                  r.source === 'builtin'
                    ? ''
                    : status === undefined
                      ? ' — checking…'
                      : status.ok
                        ? ' — Installed ✓'
                        : ' — Not installed → Open Runners';
                return (
                  <option key={r.id} value={r.id} disabled={disabled} title={hint}>
                    {r.displayName} ({sourceBadge}){inlineSuffix}
                  </option>
                );
              })
            )}
          </select>
          {!selectedRunnerInstalled && (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              Runner not installed.{' '}
              <a
                href="#/settings/runners"
                style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}
              >
                Open Runners settings
              </a>
              .
            </span>
          )}
        </label>

        {isExternalRunner && (
          <div className="agent-spawn-runner-note settings-section-desc">
            This runner uses its own provider and tools — OpenCodex approvals do not apply inside
            the harness.
          </div>
        )}

        {!isExternalRunner && (
          <div className="agent-spawn-row">
            <label className="agent-spawn-field">
              <span>Provider</span>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                style={fieldErrors.provider ? { borderColor: 'var(--danger-border)' } : undefined}
              >
                {providerOptions.length === 0 ? (
                  <option value="">No configured providers</option>
                ) : (
                  providerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.provider && (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>{fieldErrors.provider}</span>
              )}
            </label>

            <label className="agent-spawn-field">
              <span>Model</span>
              <select
                value={effectiveModelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={modelOptions.length === 0}
                style={fieldErrors.model ? { borderColor: 'var(--danger-border)' } : undefined}
              >
                {modelOptions.length === 0 ? (
                  <option value="">No models available</option>
                ) : (
                  modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.model && (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>{fieldErrors.model}</span>
              )}
            </label>
          </div>
        )}

        <label className="agent-spawn-field">
          <span>Workspace</span>
          <div className="agent-spawn-workspace">
            <code>{workspaceRoot || '(none selected)'}</code>
            <button type="button" onClick={() => void handleBrowse()}>
              Change…
            </button>
          </div>
          {fieldErrors.workspace && (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>{fieldErrors.workspace}</span>
          )}
        </label>

        <label className="agent-spawn-toggle">
          <input
            type="checkbox"
            checked={effectiveUseWorktree}
            disabled={isExternalRunner || isRepo !== true}
            onChange={(e) => setUseWorktree(e.target.checked)}
          />
          <span>
            Use git worktree
            {isExternalRunner ? ' (forced on for external runners)' : ''}
            {!isExternalRunner && isRepo === false ? ' (workspace is not a git repo)' : ''}
            {!isExternalRunner && isRepo === null ? ' (checking…)' : ''}
          </span>
        </label>

        {showWorktreePreview && (
          <div
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 6,
              padding: '8px 12px',
              background: 'var(--bg-sunken)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.04em' }}>
              WORKTREE PREVIEW
            </span>
            <span>
              Branch: <code>{branchPrefix}&lt;id-prefix&gt;</code>
            </span>
            <span style={{ overflowWrap: 'anywhere' }}>
              Worktree: <code>{`${worktreeRoot}${previewSeparator}<id>`}</code>
            </span>
          </div>
        )}

        {error && <p className="approvals-save-error">{error}</p>}

        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit}
              onClick={() => void submit()}
              title="Spawn task (Cmd/Ctrl+Enter)"
            >
              {busy ? 'Spawning…' : 'Spawn task'}
            </button>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
