import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_NETWORK_ALLOWLIST, type NetworkPolicy } from '../../shared/network-policy';

const HOSTNAME_PATTERN = /^[a-z0-9.*-]+$/i;

function validateEntry(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0) return 'Hostname is required.';
  if (v.length > 253) return 'Hostname is too long.';
  if (!HOSTNAME_PATTERN.test(v)) {
    return 'Only letters, digits, dots, dashes, and a leading "*." are allowed.';
  }
  return null;
}

export function PrivacyPanel(): JSX.Element {
  // window.opencodex.network is stable for the renderer lifetime; reading directly
  // is correct, and useMemo([]) here gave the wrong impression of reactivity.
  const networkApi = window.opencodex?.network;
  const [policy, setPolicy] = useState<NetworkPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(() =>
    networkApi
      ? null
      : 'Local Only mode is not wired to the main process yet. Restart the app after installing this build.',
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (!networkApi) return;
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const p = await networkApi.getPolicy();
        if (!cancelled) setPolicy(p);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    });
    const off = networkApi.onChanged((payload) => {
      if (!cancelled) setPolicy(payload.policy);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [networkApi]);

  const isDefault = useMemo(() => {
    if (!policy) return false;
    return DEFAULT_NETWORK_ALLOWLIST.every((d) => policy.allowlist.includes(d));
  }, [policy]);

  const handleToggleLocalOnly = async (enabled: boolean): Promise<void> => {
    const api = window.opencodex.network;
    if (!api) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await api.setLocalOnly(enabled);
      setPolicy(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const validation = validateEntry(draft);
    if (validation) {
      setDraftError(validation);
      return;
    }
    const api = window.opencodex.network;
    if (!api) return;
    setBusy(true);
    setActionError(null);
    setDraftError(null);
    try {
      const next = await api.addAllowlistEntry(draft.trim());
      setPolicy(next);
      setDraft('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (entry: string): Promise<void> => {
    const api = window.opencodex.network;
    if (!api) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await api.removeAllowlistEntry(entry);
      setPolicy(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return <p className="approvals-save-error">{loadError}</p>;
  }
  if (!policy) {
    return <p className="telemetry-loading">Loading…</p>;
  }

  return (
    <div className="privacy-panel" data-settings-anchor="privacy-root">
      <div className="settings-block" data-settings-anchor="local-only">
        <p className="privacy-explainer">
          <strong>Local Only mode</strong> blocks every outbound HTTP(S) request that does not
          target <code>127.0.0.1</code>, <code>localhost</code>, or a host ending in{' '}
          <code>.local</code>. Use it when you only run local models (e.g. Ollama, llama.cpp) and
          never want a token to leak to a hosted API — even by accident.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={policy.localOnlyMode}
            onChange={(e) => void handleToggleLocalOnly(e.target.checked)}
            disabled={busy}
          />
          <span>
            <strong>Local Only mode</strong>
            <span className="settings-block-hint">
              When ON, the title-bar pill turns green and every non-local request fails with{' '}
              <code>LocalOnlyBlockedError</code>.
            </span>
          </span>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-block" data-settings-anchor="allowlist">
        <h3 className="settings-subhead">Network allowlist</h3>
        <p className="settings-block-hint">
          When Local Only is OFF, the allowlist gates every outbound request. Empty allowlist =
          allow all (legacy behavior). Wildcards like <code>*.anthropic.com</code> are supported.
        </p>

        <div className="settings-field-row">
          <input
            type="text"
            className="settings-input"
            value={draft}
            placeholder="api.openai.com or *.anthropic.com"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftError) setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAdd();
              }
            }}
            disabled={busy}
            aria-invalid={draftError !== null}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void handleAdd()}
            disabled={busy || draft.trim().length === 0}
          >
            Add
          </button>
        </div>
        {draftError ? <p className="approvals-save-error">{draftError}</p> : null}

        <ul className="privacy-allowlist">
          {policy.allowlist.length === 0 ? (
            <li className="privacy-allowlist-empty">
              Allowlist is empty — all outbound requests are allowed.
            </li>
          ) : (
            policy.allowlist.map((entry) => (
              <li key={entry} className="privacy-allowlist-entry">
                <span>{entry}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleRemove(entry)}
                  disabled={busy}
                  aria-label={`Remove ${entry}`}
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
        {!isDefault ? (
          <p className="settings-block-hint">
            Note: removing <code>127.0.0.1</code>, <code>localhost</code>, or <code>*.local</code>{' '}
            disables Ollama and other local model servers when Local Only is OFF and the allowlist
            is non-empty.
          </p>
        ) : null}
      </div>

      <div className="settings-divider" />

      <div className="settings-block" data-settings-anchor="threat-model">
        <h3 className="settings-subhead">Threat model</h3>
        <p className="privacy-explainer">
          OpenCodex is local-first. Even so, every external request — provider HTTPS, the{' '}
          <code>web_fetch</code> tool, MCP servers, plugin code — is a potential exfiltration
          channel. Local Only mode and the allowlist exist so you can prove to yourself (and to a
          compliance team) that no data leaves your machine when working with a sensitive codebase.
        </p>
        <ul className="privacy-threat-list">
          <li>
            <strong>What it protects against:</strong> a tool, plugin, or provider call that, by
            accident or by prompt injection, tries to reach a host outside the allowlist.
          </li>
          <li>
            <strong>What it does NOT protect against:</strong> running shell commands that issue
            their own network requests (e.g. <code>curl</code>, <code>git push</code>), data written
            into files the OS later syncs to a cloud drive, or trusted plugins executing arbitrary
            OS calls. Approve <code>execute</code>-tier tools with care.
          </li>
          <li>
            <strong>Audit:</strong> blocked requests throw <code>LocalOnlyBlockedError</code> /
            <code> NetworkAllowlistBlockedError</code>. Tool errors are recorded in the audit log.
          </li>
        </ul>
        <p className="settings-block-hint">
          See <code>docs/local-only-threat-model.md</code> for the full threat model with
          attack-tree diagrams.
        </p>
      </div>

      {actionError ? <p className="approvals-save-error">{actionError}</p> : null}
    </div>
  );
}
