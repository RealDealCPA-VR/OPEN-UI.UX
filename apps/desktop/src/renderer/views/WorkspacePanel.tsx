import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceState } from '../../shared/workspace';

export function WorkspacePanel(): JSX.Element {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setState(payload.state);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleBrowse = useCallback(async () => {
    setPending('browse');
    setActionError(null);
    try {
      const next = await window.opencodex.workspace.browse();
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((p) => (p === 'browse' ? null : p));
    }
  }, []);

  const handleSetActive = useCallback(async (path: string) => {
    const key = `set:${path}`;
    setPending(key);
    setActionError(null);
    try {
      const next = await window.opencodex.workspace.setActive({ path });
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((p) => (p === key ? null : p));
    }
  }, []);

  const handleRemove = useCallback(async (path: string) => {
    const key = `remove:${path}`;
    setPending(key);
    setActionError(null);
    try {
      const next = await window.opencodex.workspace.remove({ path });
      setState(next);
      setConfirmingRemove((cur) => (cur === path ? null : cur));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((p) => (p === key ? null : p));
    }
  }, []);

  const handleClearActive = useCallback(async () => {
    setPending('clear');
    setActionError(null);
    try {
      const next = await window.opencodex.workspace.clearActive();
      setState(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending((p) => (p === 'clear' ? null : p));
    }
  }, []);

  if (loadError) {
    return (
      <div
        role="alert"
        className="workspace-action-error"
        style={{
          padding: 10,
          background: 'var(--danger-bg)',
          color: 'var(--danger)',
          border: '1px solid var(--danger-border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div>Failed to load workspace state: {loadError}</div>
        <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  if (!state) {
    return <p className="workspace-loading">Loading…</p>;
  }

  const recent = state.history.filter((p) => p !== state.active);

  return (
    <div className="workspace-panel">
      <div className="settings-block">
        <h3 className="settings-subhead">Active workspace</h3>
        <p className="settings-block-hint">
          Tools the agent runs (read/write files, shell commands) are anchored to this folder. If
          unset, the launch directory is used.
        </p>
        <div className="workspace-active">
          {state.active ? (
            <code className="workspace-path">{state.active}</code>
          ) : (
            <span className="workspace-path workspace-path-unset">
              (none — using launch directory)
            </span>
          )}
          <div className="workspace-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleBrowse()}
              disabled={pending === 'browse'}
            >
              Choose Folder
            </button>
            {state.active && (
              <button
                type="button"
                className="btn"
                onClick={() => void handleClearActive()}
                disabled={pending === 'clear'}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <h3 className="settings-subhead">Recent</h3>
        {recent.length === 0 ? (
          <p className="settings-block-hint">No recent workspaces yet.</p>
        ) : (
          <ul className="workspace-list">
            {recent.map((path) => {
              const setKey = `set:${path}`;
              const removeKey = `remove:${path}`;
              const confirming = confirmingRemove === path;
              return (
                <li key={path} className="workspace-row">
                  <code className="workspace-path">{path}</code>
                  <div className="workspace-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleSetActive(path)}
                      disabled={pending === setKey}
                    >
                      Open
                    </button>
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => void handleRemove(path)}
                          disabled={pending === removeKey}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmingRemove(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setConfirmingRemove(path)}
                        disabled={pending === removeKey}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {actionError && <p className="field-errors workspace-action-error">Failed: {actionError}</p>}
    </div>
  );
}
