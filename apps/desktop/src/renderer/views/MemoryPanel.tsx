import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryBackendId,
  MemoryBackendStatus,
  MemoryConfig,
  MemoryStatus,
  TestConnectionResult,
} from '../../shared/memory';

type WindowWithBrowse = Window & {
  opencodex: Window['opencodex'] & {
    workspace?: { pickFolder?: () => Promise<string | null> };
  };
};

export interface MemoryPanelProps {
  className?: string;
}

interface BusyState {
  notionTokenSaving: boolean;
  testing: MemoryBackendId | null;
}

export function MemoryPanel(props: MemoryPanelProps = {}): JSX.Element {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notionTokenDraft, setNotionTokenDraft] = useState<string>('');
  const [testResults, setTestResults] = useState<
    Record<MemoryBackendId, TestConnectionResult | null>
  >({
    obsidian: null,
    notion: null,
    'local-fs': null,
  });
  const [busy, setBusy] = useState<BusyState>({ notionTokenSaving: false, testing: null });
  const [confirmingClearToken, setConfirmingClearToken] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const flashSaved = (key: string): void => {
    setSavedFlash(key);
    window.setTimeout(() => {
      setSavedFlash((k) => (k === key ? null : k));
    }, 1200);
  };

  useEffect(() => {
    let cancelled = false;
    window.opencodex.memory
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.memory.onChanged((payload) => {
      if (!cancelled) setStatus(payload.status);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const applyConfig = useCallback(async (next: MemoryConfig) => {
    setActionError(null);
    try {
      const updated = await window.opencodex.memory.setConfig(next);
      setStatus(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggleBackend = useCallback(
    (backend: 'obsidian' | 'notion', enabled: boolean) => {
      if (!status) return;
      const next: MemoryConfig = {
        backends: {
          ...status.config.backends,
          [backend]: { ...status.config.backends[backend], enabled },
        },
      };
      void applyConfig(next);
    },
    [status, applyConfig],
  );

  const toggleLocalFs = useCallback(
    (enabled: boolean) => {
      if (!status) return;
      const next: MemoryConfig = {
        backends: {
          ...status.config.backends,
          localFs: { ...status.config.backends.localFs, enabled },
        },
      };
      void applyConfig(next);
    },
    [status, applyConfig],
  );

  const setVaultPath = useCallback(
    (vaultPath: string) => {
      if (!status) return;
      const next: MemoryConfig = {
        backends: {
          ...status.config.backends,
          obsidian: { ...status.config.backends.obsidian, vaultPath },
        },
      };
      void applyConfig(next);
    },
    [status, applyConfig],
  );

  const browseVault = useCallback(async () => {
    const ext = window as WindowWithBrowse;
    const picker = ext.opencodex.workspace?.pickFolder;
    if (typeof picker !== 'function') return;
    try {
      const picked = await picker();
      if (picked) setVaultPath(picked);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [setVaultPath]);

  const saveNotionToken = useCallback(async () => {
    if (notionTokenDraft.length === 0) return;
    setBusy((b) => ({ ...b, notionTokenSaving: true }));
    setActionError(null);
    try {
      const updated = await window.opencodex.memory.setNotionToken(notionTokenDraft);
      setStatus(updated);
      setNotionTokenDraft('');
      flashSaved('notionToken');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((b) => ({ ...b, notionTokenSaving: false }));
    }
  }, [notionTokenDraft]);

  const clearNotionToken = useCallback(async () => {
    setActionError(null);
    try {
      const updated = await window.opencodex.memory.clearNotionToken();
      setStatus(updated);
      setConfirmingClearToken(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runTest = useCallback(async (backend: MemoryBackendId) => {
    setBusy((b) => ({ ...b, testing: backend }));
    setActionError(null);
    try {
      const result = await window.opencodex.memory.testConnection(backend);
      setTestResults((r) => ({ ...r, [backend]: result }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((b) => ({ ...b, testing: null }));
    }
  }, []);

  if (loadError) {
    return (
      <div role="alert" className="field-errors memory-load-error">
        Failed to load memory state: {loadError}
      </div>
    );
  }
  if (!status) {
    return <p className="memory-loading">Loading…</p>;
  }

  const obsidian = status.backends.find((b) => b.id === 'obsidian') ?? fallbackStatus('obsidian');
  const notion = status.backends.find((b) => b.id === 'notion') ?? fallbackStatus('notion');
  const localFs = status.backends.find((b) => b.id === 'local-fs') ?? fallbackStatus('local-fs');

  return (
    <div className={`memory-panel${props.className ? ` ${props.className}` : ''}`}>
      <div className="settings-block">
        <div className="settings-subhead-row">
          <h3 className="settings-subhead">Obsidian vault</h3>
          <StatusPill status={obsidian} />
        </div>
        <p className="settings-block-hint">
          Point the agent at a folder of markdown notes. Read tools run without a prompt; write
          tools (append, create) ask first.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={status.config.backends.obsidian.enabled}
            onChange={(e) => toggleBackend('obsidian', e.target.checked)}
          />
          <span>Enable Obsidian backend</span>
        </label>
        <label className="settings-field-row">
          <span className="settings-field-label">Vault folder</span>
          <input
            type="text"
            className="settings-input"
            value={status.config.backends.obsidian.vaultPath}
            placeholder="/path/to/vault"
            onChange={(e) => setVaultPath(e.target.value)}
          />
          {typeof (window as WindowWithBrowse).opencodex.workspace?.pickFolder === 'function' && (
            <button type="button" className="btn" onClick={() => void browseVault()}>
              Browse…
            </button>
          )}
        </label>
        <div className="settings-field-row">
          <button
            type="button"
            className="btn"
            onClick={() => void runTest('obsidian')}
            disabled={busy.testing === 'obsidian'}
          >
            Test connection
          </button>
          {testResults.obsidian && <TestResultPill result={testResults.obsidian} />}
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <div className="settings-subhead-row">
          <h3 className="settings-subhead">Notion</h3>
          <StatusPill status={notion} />
        </div>
        <p className="settings-block-hint">
          Provide a Notion integration token (stored in OS keychain). Share the pages and databases
          you want the agent to access with that integration.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={status.config.backends.notion.enabled}
            onChange={(e) => toggleBackend('notion', e.target.checked)}
          />
          <span>Enable Notion backend</span>
        </label>
        <label className="settings-field-row">
          <span className="settings-field-label">Integration token</span>
          <input
            type="password"
            className="settings-input"
            value={notionTokenDraft}
            placeholder={
              status.hasNotionToken ? 'Token is set — leave blank to keep' : 'secret_...'
            }
            onChange={(e) => setNotionTokenDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void saveNotionToken()}
            disabled={busy.notionTokenSaving || notionTokenDraft.length === 0}
          >
            {busy.notionTokenSaving ? 'Saving…' : 'Save token'}
          </button>
          {savedFlash === 'notionToken' && (
            <span aria-live="polite" className="settings-saved-flash">
              Saved
            </span>
          )}
          {status.hasNotionToken &&
            (confirmingClearToken ? (
              <span className="memory-confirm-row">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void clearNotionToken()}
                >
                  Confirm clear
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmingClearToken(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmingClearToken(true)}
              >
                Clear
              </button>
            ))}
        </label>
        <div className="settings-field-row">
          <button
            type="button"
            className="btn"
            onClick={() => void runTest('notion')}
            disabled={busy.testing === 'notion'}
          >
            Test connection
          </button>
          {testResults.notion && <TestResultPill result={testResults.notion} />}
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <div className="settings-subhead-row">
          <h3 className="settings-subhead">Local workspace memory</h3>
          <StatusPill status={localFs} />
        </div>
        <p className="settings-block-hint">
          Keep a per-workspace memory.md the agent can read, search, and append to. Tools target the
          currently active workspace.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={status.config.backends.localFs.enabled}
            onChange={(e) => toggleLocalFs(e.target.checked)}
          />
          <span>Enable local workspace memory</span>
        </label>
      </div>

      {actionError && (
        <p className="field-errors" role="alert">
          Failed: {actionError}
        </p>
      )}
    </div>
  );
}

function fallbackStatus(id: MemoryBackendId): MemoryBackendStatus {
  return { id, enabled: false, configured: false, registered: false, toolCount: 0 };
}

function StatusPill({ status }: { status: MemoryBackendStatus }): JSX.Element {
  if (!status.enabled) return <span className="pill pill-neutral">Disabled</span>;
  if (!status.configured) return <span className="pill pill-warn">Not configured</span>;
  if (status.lastError) return <span className="pill pill-danger">Error</span>;
  if (status.registered) {
    return (
      <span className="pill pill-ok">
        Connected · {status.toolCount} tool{status.toolCount === 1 ? '' : 's'}
      </span>
    );
  }
  return <span className="pill pill-warn">Idle</span>;
}

function TestResultPill({ result }: { result: TestConnectionResult }): JSX.Element {
  if (result.ok) {
    const detail =
      result.detail?.userName ??
      (result.detail?.noteCount !== undefined ? `${result.detail.noteCount} notes` : 'OK');
    return <span className="pill pill-ok">OK · {detail}</span>;
  }
  return <span className="pill pill-danger">{result.error ?? 'Failed'}</span>;
}
