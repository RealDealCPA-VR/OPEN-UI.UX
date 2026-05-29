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
    return <p className="memory-error">Failed to load memory state: {loadError}</p>;
  }
  if (!status) {
    return <p className="memory-loading">Loading…</p>;
  }

  const obsidian = status.backends.find((b) => b.id === 'obsidian') ?? fallbackStatus('obsidian');
  const notion = status.backends.find((b) => b.id === 'notion') ?? fallbackStatus('notion');

  return (
    <div className={`memory-panel${props.className ? ` ${props.className}` : ''}`}>
      <div className="memory-subsection">
        <header className="memory-subhead">
          <h3>Obsidian vault</h3>
          <StatusPill status={obsidian} />
        </header>
        <p className="memory-subhead-desc">
          Point the agent at a folder of markdown notes. Read tools run without a prompt; write
          tools (append, create) ask first.
        </p>
        <label className="memory-field">
          <input
            type="checkbox"
            checked={status.config.backends.obsidian.enabled}
            onChange={(e) => toggleBackend('obsidian', e.target.checked)}
          />
          <span>Enable Obsidian backend</span>
        </label>
        <label className="memory-field">
          <span>Vault folder</span>
          <input
            type="text"
            value={status.config.backends.obsidian.vaultPath}
            placeholder="/path/to/vault"
            onChange={(e) => setVaultPath(e.target.value)}
          />
          {typeof (window as WindowWithBrowse).opencodex.workspace?.pickFolder === 'function' && (
            <button type="button" className="memory-btn" onClick={() => void browseVault()}>
              Browse…
            </button>
          )}
        </label>
        <div className="memory-actions">
          <button
            type="button"
            className="memory-btn"
            onClick={() => void runTest('obsidian')}
            disabled={busy.testing === 'obsidian'}
          >
            Test connection
          </button>
          {testResults.obsidian && <TestResultPill result={testResults.obsidian} />}
        </div>
      </div>

      <div className="memory-subsection">
        <header className="memory-subhead">
          <h3>Notion</h3>
          <StatusPill status={notion} />
        </header>
        <p className="memory-subhead-desc">
          Provide a Notion integration token (stored in OS keychain). Share the pages and databases
          you want the agent to access with that integration.
        </p>
        <label className="memory-field">
          <input
            type="checkbox"
            checked={status.config.backends.notion.enabled}
            onChange={(e) => toggleBackend('notion', e.target.checked)}
          />
          <span>Enable Notion backend</span>
        </label>
        <label className="memory-field">
          <span>Integration token</span>
          <input
            type="password"
            value={notionTokenDraft}
            placeholder={
              status.hasNotionToken ? 'Token is set — leave blank to keep' : 'secret_...'
            }
            onChange={(e) => setNotionTokenDraft(e.target.value)}
          />
          <button
            type="button"
            className="memory-btn"
            onClick={() => void saveNotionToken()}
            disabled={busy.notionTokenSaving || notionTokenDraft.length === 0}
          >
            {busy.notionTokenSaving ? 'Saving…' : 'Save token'}
          </button>
          {savedFlash === 'notionToken' && (
            <span
              aria-live="polite"
              style={{
                fontSize: 12,
                color: 'var(--success, #22c55e)',
                marginLeft: 6,
              }}
            >
              Saved
            </span>
          )}
          {status.hasNotionToken &&
            (confirmingClearToken ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
                <button
                  type="button"
                  className="memory-btn memory-btn-danger"
                  onClick={() => void clearNotionToken()}
                >
                  Confirm clear
                </button>
                <button
                  type="button"
                  className="memory-btn"
                  onClick={() => setConfirmingClearToken(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="memory-btn memory-btn-danger"
                onClick={() => setConfirmingClearToken(true)}
              >
                Clear
              </button>
            ))}
        </label>
        <div className="memory-actions">
          <button
            type="button"
            className="memory-btn"
            onClick={() => void runTest('notion')}
            disabled={busy.testing === 'notion'}
          >
            Test connection
          </button>
          {testResults.notion && <TestResultPill result={testResults.notion} />}
        </div>
      </div>

      {actionError && <p className="memory-action-error">Failed: {actionError}</p>}
    </div>
  );
}

function fallbackStatus(id: MemoryBackendId): MemoryBackendStatus {
  return { id, enabled: false, configured: false, registered: false, toolCount: 0 };
}

function StatusPill({ status }: { status: MemoryBackendStatus }): JSX.Element {
  if (!status.enabled) return <span className="memory-pill memory-pill-off">Disabled</span>;
  if (!status.configured)
    return <span className="memory-pill memory-pill-warn">Not configured</span>;
  if (status.lastError) return <span className="memory-pill memory-pill-error">Error</span>;
  if (status.registered) {
    return (
      <span className="memory-pill memory-pill-ok">
        Connected · {status.toolCount} tool{status.toolCount === 1 ? '' : 's'}
      </span>
    );
  }
  return <span className="memory-pill memory-pill-warn">Idle</span>;
}

function TestResultPill({ result }: { result: TestConnectionResult }): JSX.Element {
  if (result.ok) {
    const detail =
      result.detail?.userName ??
      (result.detail?.noteCount !== undefined ? `${result.detail.noteCount} notes` : 'OK');
    return <span className="memory-pill memory-pill-ok">OK · {detail}</span>;
  }
  return <span className="memory-pill memory-pill-error">{result.error ?? 'Failed'}</span>;
}
