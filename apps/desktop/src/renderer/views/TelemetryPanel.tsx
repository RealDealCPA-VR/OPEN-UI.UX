import { useEffect, useState } from 'react';
import type { TelemetryConfig } from '../../shared/telemetry';

export function TelemetryPanel(): JSX.Element {
  const [config, setConfig] = useState<TelemetryConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [hostDraft, setHostDraft] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const flashSaved = (key: string): void => {
    setSavedFlash(key);
    window.setTimeout(() => {
      setSavedFlash((k) => (k === key ? null : k));
    }, 1200);
  };

  useEffect(() => {
    let cancelled = false;
    window.opencodex.telemetry
      .getConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setApiKeyDraft(c.apiKey);
        setHostDraft(c.host ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.telemetry.onConfigChanged((payload) => {
      if (cancelled) return;
      setConfig(payload.config);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleToggleEnabled = async (enabled: boolean): Promise<void> => {
    setSavingField('enabled');
    setSaveError(null);
    try {
      const next = await window.opencodex.telemetry.setConfig({ enabled });
      setConfig(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveApiKey = async (): Promise<void> => {
    setSavingField('apiKey');
    setSaveError(null);
    try {
      const next = await window.opencodex.telemetry.setConfig({ apiKey: apiKeyDraft });
      setConfig(next);
      flashSaved('apiKey');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveHost = async (): Promise<void> => {
    setSavingField('host');
    setSaveError(null);
    try {
      const trimmed = hostDraft.trim();
      const next = await window.opencodex.telemetry.setConfig({
        host: trimmed.length === 0 ? null : trimmed,
      });
      setConfig(next);
      flashSaved('host');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  if (loadError) {
    return <p className="chat-warn">Failed to load telemetry config: {loadError}</p>;
  }
  if (!config) {
    return <p className="telemetry-loading">Loading…</p>;
  }

  return (
    <div className="telemetry-panel">
      <div className="settings-block">
        <p className="privacy-explainer">
          Telemetry is <strong>off by default</strong> and uses a destination you provide. OpenCodex
          never collects analytics on its own. When enabled, anonymous usage events (e.g. which
          features are used, error counts) are sent to your configured endpoint. No prompts,
          completions, file contents, or API keys are ever sent.
        </p>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => void handleToggleEnabled(e.target.checked)}
            disabled={savingField === 'enabled'}
          />
          <span>Enable anonymous usage telemetry</span>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <label className="settings-field-label" htmlFor="telemetry-api-key">
          PostHog project API key
        </label>
        <div className="settings-field-row">
          <input
            id="telemetry-api-key"
            type="password"
            className="settings-input"
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder="phc_…"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveApiKey()}
            disabled={savingField === 'apiKey' || apiKeyDraft === config.apiKey}
          >
            Save
          </button>
          {savedFlash === 'apiKey' && (
            <span aria-live="polite" style={{ fontSize: 12, color: 'var(--success, #22c55e)' }}>
              Saved
            </span>
          )}
        </div>
      </div>

      <div className="settings-block">
        <label className="settings-field-label" htmlFor="telemetry-host">
          Custom host (optional)
        </label>
        <div className="settings-field-row">
          <input
            id="telemetry-host"
            type="url"
            className="settings-input"
            value={hostDraft}
            onChange={(e) => setHostDraft(e.target.value)}
            placeholder="https://eu.posthog.com"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveHost()}
            disabled={savingField === 'host' || hostDraft === (config.host ?? '')}
          >
            Save
          </button>
          {savedFlash === 'host' && (
            <span aria-live="polite" style={{ fontSize: 12, color: 'var(--success, #22c55e)' }}>
              Saved
            </span>
          )}
        </div>
        <p className="settings-block-hint">Leave blank to use the PostHog default cloud host.</p>
      </div>

      {saveError ? <p className="chat-warn">{saveError}</p> : null}
    </div>
  );
}
