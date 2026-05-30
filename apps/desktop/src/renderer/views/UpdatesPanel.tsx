import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateState, UpdateStatus } from '../../shared/updates';

export interface UpdatesPanelProps {
  onCheckRef?: (fn: () => void) => void;
}

export function UpdatesPanel({ onCheckRef }: UpdatesPanelProps = {}): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAuto, setSavingAuto] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.opencodex.updates
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.updates.onStatusChanged((payload) => {
      if (!cancelled) setStatus(payload);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const checkingRef = useRef(checking);
  useEffect(() => {
    checkingRef.current = checking;
  }, [checking]);

  const handleCheck = useCallback(async (): Promise<void> => {
    if (checkingRef.current) return;
    setChecking(true);
    setActionError(null);
    try {
      const result = await window.opencodex.updates.check();
      if (!result.ok && result.error) setActionError(result.error);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    onCheckRef?.(() => void handleCheck());
  }, [onCheckRef, handleCheck]);

  const handleDownload = async (): Promise<void> => {
    setDownloading(true);
    setActionError(null);
    try {
      await window.opencodex.updates.download();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const handleQuitAndInstall = async (): Promise<void> => {
    setActionError(null);
    try {
      await window.opencodex.updates.quitAndInstall();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAutoCheck = async (next: boolean): Promise<void> => {
    setSavingAuto(true);
    setActionError(null);
    try {
      await window.opencodex.updates.setAutoCheck(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAuto(false);
    }
  };

  if (loadError) {
    return (
      <div className="settings-block">
        <p className="chat-warn" role="alert">
          Failed to load updater status: {loadError}
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="settings-block">
        <p className="updates-loading">Loading updater status…</p>
      </div>
    );
  }

  return (
    <div className="updates-panel">
      <div className="settings-block">
        <label className="toggle">
          <input
            type="checkbox"
            checked={status.autoCheckEnabled}
            onChange={(e) => void handleAutoCheck(e.target.checked)}
            disabled={savingAuto}
          />
          <span>Check for updates automatically</span>
        </label>
        <p className="settings-block-hint">
          When enabled, OpenCodex checks the release feed on startup and once every six hours.
        </p>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <div className="updates-status-row">
          <UpdateStatusPill status={status} />
          <button
            type="button"
            className="btn"
            onClick={() => void handleCheck()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
          {status.state === 'available' ? (
            <button
              type="button"
              className="btn"
              onClick={() => void handleDownload()}
              disabled={downloading}
            >
              {downloading ? 'Downloading…' : 'Download update'}
            </button>
          ) : null}
          {status.state === 'downloaded' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleQuitAndInstall()}
            >
              Restart and install
            </button>
          ) : null}
        </div>
        {status.percent !== null && status.state === 'downloading' ? (
          <p className="updates-progress">Downloading… {Math.round(status.percent)}%</p>
        ) : null}
        {status.version ? <p className="updates-version">Version {status.version}</p> : null}
        {status.error ? <p className="chat-warn">{status.error}</p> : null}
        {actionError ? <p className="chat-warn">{actionError}</p> : null}
      </div>
    </div>
  );
}

function UpdateStatusPill({ status }: { status: UpdateStatus }): JSX.Element {
  const { label, tone } = pillForState(status.state);
  return <span className={`pill pill-${tone}`}>{label}</span>;
}

function pillForState(state: UpdateState): {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  switch (state) {
    case 'idle':
      return { label: 'Idle', tone: 'neutral' };
    case 'checking':
      return { label: 'Checking', tone: 'neutral' };
    case 'available':
      return { label: 'Update available', tone: 'warn' };
    case 'not-available':
      return { label: 'Up to date', tone: 'ok' };
    case 'downloading':
      return { label: 'Downloading', tone: 'neutral' };
    case 'downloaded':
      return { label: 'Ready to install', tone: 'ok' };
    case 'error':
      return { label: 'Error', tone: 'danger' };
  }
}
