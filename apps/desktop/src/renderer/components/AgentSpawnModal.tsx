import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelectedModel } from '../state/selected-model-context';

export interface AgentSpawnModalProps {
  initialTask?: string;
  initialWorkspaceRoot?: string;
  onClose: () => void;
  onSpawned: (runId: string) => void;
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
    if (!task.trim() || !providerId || !effectiveModelId || !workspaceRoot) return;
    setBusy(true);
    try {
      const res = await window.opencodex.agent.spawnFromUi({
        task: task.trim(),
        providerId,
        modelId: effectiveModelId,
        workspaceRoot,
        useWorktree: useWorktree && isRepo === true,
      });
      onSpawned(res.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [task, providerId, effectiveModelId, workspaceRoot, useWorktree, isRepo, onSpawned]);

  const canSubmit =
    !busy &&
    task.trim().length > 0 &&
    providerId !== '' &&
    effectiveModelId !== '' &&
    workspaceRoot !== '';

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
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
          />
        </label>

        <div className="agent-spawn-row">
          <label className="agent-spawn-field">
            <span>Provider</span>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
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
          </label>

          <label className="agent-spawn-field">
            <span>Model</span>
            <select
              value={effectiveModelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={modelOptions.length === 0}
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
          </label>
        </div>

        <label className="agent-spawn-field">
          <span>Workspace</span>
          <div className="agent-spawn-workspace">
            <code>{workspaceRoot || '(none selected)'}</code>
            <button type="button" onClick={() => void handleBrowse()}>
              Change…
            </button>
          </div>
        </label>

        <label className="agent-spawn-toggle">
          <input
            type="checkbox"
            checked={useWorktree && isRepo === true}
            disabled={isRepo !== true}
            onChange={(e) => setUseWorktree(e.target.checked)}
          />
          <span>
            Use git worktree
            {isRepo === false ? ' (workspace is not a git repo)' : ''}
            {isRepo === null ? ' (checking…)' : ''}
          </span>
        </label>

        {error && <p className="approvals-save-error">{error}</p>}

        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSubmit}
              onClick={() => void submit()}
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
