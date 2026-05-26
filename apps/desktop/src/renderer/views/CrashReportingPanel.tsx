import { useEffect, useState } from 'react';
import type { CrashReportingConfig } from '../../shared/crash-reporting';

const ENVIRONMENTS: ReadonlyArray<string> = ['production', 'staging', 'development'];

export function CrashReportingPanel(): JSX.Element {
  const [config, setConfig] = useState<CrashReportingConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [dsnDraft, setDsnDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.opencodex.crashReporting
      .getConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setDsnDraft(c.dsn);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.crashReporting.onConfigChanged((payload) => {
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
      const next = await window.opencodex.crashReporting.setConfig({ enabled });
      setConfig(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  const handleSaveDsn = async (): Promise<void> => {
    setSavingField('dsn');
    setSaveError(null);
    try {
      const next = await window.opencodex.crashReporting.setConfig({ dsn: dsnDraft });
      setConfig(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  const handleEnvironmentChange = async (environment: string): Promise<void> => {
    setSavingField('environment');
    setSaveError(null);
    try {
      const next = await window.opencodex.crashReporting.setConfig({ environment });
      setConfig(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingField(null);
    }
  };

  if (loadError) {
    return <p className="chat-warn">Failed to load crash-reporting config: {loadError}</p>;
  }
  if (!config) {
    return <p className="crash-loading">Loading…</p>;
  }

  return (
    <div className="crash-panel">
      <div className="settings-block">
        <p className="privacy-explainer">
          Crash reporting is <strong>off by default</strong>. When enabled, OpenCodex sends stack
          traces from unhandled errors to your configured Sentry DSN. Trace data is scrubbed of
          local file paths, prompts, completions, and API keys before send. No reports are generated
          unless you supply a DSN.
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
          <span>Enable crash reporting</span>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <label className="settings-field-label" htmlFor="crash-dsn">
          Sentry DSN
        </label>
        <div className="settings-field-row">
          <input
            id="crash-dsn"
            type="url"
            className="settings-input"
            value={dsnDraft}
            onChange={(e) => setDsnDraft(e.target.value)}
            placeholder="https://<key>@sentry.example.com/<project>"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void handleSaveDsn()}
            disabled={savingField === 'dsn' || dsnDraft === config.dsn}
          >
            Save
          </button>
        </div>
      </div>

      <div className="settings-block">
        <label className="settings-field-label" htmlFor="crash-env">
          Environment
        </label>
        <select
          id="crash-env"
          className="settings-input settings-input-select"
          value={config.environment}
          onChange={(e) => void handleEnvironmentChange(e.target.value)}
          disabled={savingField === 'environment'}
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>

      {saveError ? <p className="chat-warn">{saveError}</p> : null}
    </div>
  );
}
