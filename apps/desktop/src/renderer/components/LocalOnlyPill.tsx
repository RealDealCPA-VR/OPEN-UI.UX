import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NetworkPolicy } from '../../shared/network-policy';

export function LocalOnlyPill(): JSX.Element | null {
  const [policy, setPolicy] = useState<NetworkPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const api = window.opencodex.network;
    if (!api) return;
    void api
      .getPolicy()
      .then((p) => {
        if (!cancelled) setPolicy(p);
      })
      .catch(() => {
        // pill is advisory; tolerate load failures
      });
    const off = api.onChanged((payload) => {
      if (!cancelled) setPolicy(payload.policy);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (!policy) return null;
  const on = policy.localOnlyMode;

  const handleToggle = async (): Promise<void> => {
    const api = window.opencodex.network;
    if (!api) return;
    setBusy(true);
    try {
      const next = await api.setLocalOnly(!on);
      setPolicy(next);
    } catch {
      // best-effort; user can retry
    } finally {
      setBusy(false);
    }
  };

  const handleContext = (e: React.MouseEvent): void => {
    e.preventDefault();
    navigate('/settings/privacy');
  };

  const label = on ? 'Local Only: ON' : 'Local Only: OFF';
  const title = on
    ? 'Only loopback and *.local hosts can be reached. Click to disable. Right-click to open Privacy settings.'
    : 'Outbound network is allowed (subject to allowlist). Click to enable Local Only. Right-click to open Privacy settings.';

  return (
    <button
      type="button"
      className={`local-only-pill ${on ? 'is-on' : 'is-off'}`}
      data-testid="local-only-pill"
      aria-pressed={on}
      aria-label={label}
      title={title}
      onClick={() => void handleToggle()}
      onContextMenu={handleContext}
      disabled={busy}
    >
      <span className="local-only-pill-dot" aria-hidden />
      <span className="local-only-pill-label">{label}</span>
      <style>{PILL_CSS}</style>
    </button>
  );
}

const PILL_CSS = `
  .local-only-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-btn);
    color: var(--text-primary);
    transition: background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }
  .local-only-pill:disabled { opacity: 0.6; cursor: progress; }
  .local-only-pill:hover { background: var(--bg-btn-hover); }
  .local-only-pill:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .local-only-pill.is-on {
    background: var(--success-bg);
    color: var(--success);
    border-color: var(--success-border);
  }
  .local-only-pill.is-off {
    background: var(--bg-btn);
    color: var(--text-secondary);
  }
  .local-only-pill-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 2px var(--success-bg), 0 0 0 3px var(--bg-elevated);
  }
`;
