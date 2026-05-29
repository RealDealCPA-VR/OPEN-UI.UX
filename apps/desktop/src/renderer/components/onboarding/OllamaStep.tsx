import { useCallback, useEffect, useState } from 'react';
import type {
  OllamaInstallerKind,
  OllamaInstallProgress,
  OllamaModelEntry,
  OllamaProbeResult,
} from '../../../shared/ollama';

export interface OllamaStepProps {
  onSkip: () => void;
  onContinueCloud: () => void;
  onAcceptLocalOnly: (selectedModelId: string | null) => void | Promise<void>;
}

interface InstallerState {
  installers: OllamaInstallerKind[];
  selected: OllamaInstallerKind | null;
  installing: boolean;
  installLog: string;
  installError: string | null;
}

const INSTALLER_LABELS: Readonly<Record<OllamaInstallerKind, string>> = {
  homebrew: 'Homebrew (brew install ollama)',
  winget: 'winget (Ollama.Ollama)',
  script: 'Official install script (curl | sh)',
};

function formatSize(gb: number): string {
  if (gb <= 0) return '';
  if (gb < 1) return `${Math.round(gb * 1024)} MB`;
  return `${gb.toFixed(1)} GB`;
}

export function OllamaStep({
  onSkip,
  onContinueCloud,
  onAcceptLocalOnly,
}: OllamaStepProps): JSX.Element {
  const [probe, setProbe] = useState<OllamaProbeResult | null>(null);
  const [probing, setProbing] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [installerState, setInstallerState] = useState<InstallerState>({
    installers: [],
    selected: null,
    installing: false,
    installLog: '',
    installError: null,
  });
  const [accepting, setAccepting] = useState(false);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await window.opencodex.ollama.probe();
      setProbe(result);
      if (result.running && result.models.length > 0 && selectedModelId === null) {
        const first = result.models[0];
        if (first) setSelectedModelId(first.id);
      }
    } catch (err) {
      setProbe({
        running: false,
        models: [],
        error: err instanceof Error ? err.message : 'probe failed',
      });
    } finally {
      setProbing(false);
    }
  }, [selectedModelId]);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.ollama
      .listInstallableManagers()
      .then((res) => {
        if (cancelled) return;
        setInstallerState((s) => ({
          ...s,
          installers: res.installers,
          selected: res.installers[0] ?? null,
        }));
      })
      .catch(() => {
        // installer list is advisory; skip on error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const off = window.opencodex.ollama.onInstallProgress((payload: OllamaInstallProgress) => {
      setInstallerState((s) => ({
        ...s,
        installLog: (s.installLog + payload.chunk).slice(-4000),
      }));
    });
    return () => {
      off();
    };
  }, []);

  const handleInstall = async (): Promise<void> => {
    const installer = installerState.selected;
    if (!installer) return;
    setInstallerState((s) => ({ ...s, installing: true, installError: null, installLog: '' }));
    try {
      const result = await window.opencodex.ollama.install({ installer });
      if (result.ok) {
        await runProbe();
        setInstallerState((s) => ({ ...s, installing: false }));
      } else {
        setInstallerState((s) => ({
          ...s,
          installing: false,
          installError: result.stderrTail ?? `install failed (exit ${result.exitCode})`,
        }));
      }
    } catch (err) {
      setInstallerState((s) => ({
        ...s,
        installing: false,
        installError: err instanceof Error ? err.message : 'install failed',
      }));
    }
  };

  const handleAcceptLocalOnly = async (): Promise<void> => {
    setAccepting(true);
    try {
      await onAcceptLocalOnly(selectedModelId);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="onboarding-step">
      <h3>Try with a local model first</h3>
      <p className="onboarding-step-desc">
        Run a model on this machine via Ollama. Nothing leaves your computer. Skip if you only want
        to use cloud providers.
      </p>
      <p className="onboarding-why">
        Why? Local models are private and free to run, no API keys required. Good for code, chat,
        and quick exploration.
      </p>

      {probing && (
        <p className="settings-section-desc" data-testid="ollama-probing">
          Checking for a running Ollama on 127.0.0.1:11434…
        </p>
      )}

      {!probing && probe?.running && (
        <div data-testid="ollama-running">
          <p className="settings-section-desc">
            Found Ollama with {probe.models.length} model{probe.models.length === 1 ? '' : 's'}.
          </p>
          {probe.models.length === 0 ? (
            <p className="onboarding-warn">
              No models installed. Run <code>ollama pull llama3</code> in a terminal to download
              one, then come back.
            </p>
          ) : (
            <ul className="onboarding-provider-list">
              {probe.models.map((m: OllamaModelEntry) => (
                <li key={m.id}>
                  <label
                    className={`onboarding-provider-row ${
                      selectedModelId === m.id ? 'chosen' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="ollama-model"
                      checked={selectedModelId === m.id}
                      onChange={() => setSelectedModelId(m.id)}
                    />
                    <span>
                      <strong>{m.id}</strong>
                      {m.sizeGb > 0 ? (
                        <span style={{ marginLeft: 8, opacity: 0.7 }}>{formatSize(m.sizeGb)}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!probing && probe && !probe.running && (
        <div data-testid="ollama-not-running">
          <p className="settings-section-desc">
            No Ollama detected. Install it to run models locally, or skip to use a cloud provider.
          </p>
          {installerState.installers.length === 0 ? (
            <p className="onboarding-warn">
              No supported installer found on this machine. Visit{' '}
              <code>https://ollama.com/download</code> and re-run setup.
            </p>
          ) : (
            <>
              <ul className="onboarding-provider-list">
                {installerState.installers.map((kind) => (
                  <li key={kind}>
                    <label
                      className={`onboarding-provider-row ${
                        installerState.selected === kind ? 'chosen' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="ollama-installer"
                        checked={installerState.selected === kind}
                        onChange={() => setInstallerState((s) => ({ ...s, selected: kind }))}
                      />
                      <span>{INSTALLER_LABELS[kind]}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {installerState.installError && (
                <div className="onboarding-step-error" role="alert">
                  {installerState.installError}
                </div>
              )}
              {installerState.installing && (
                <pre
                  data-testid="ollama-install-log"
                  style={{
                    background: 'var(--bg-sunken)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 12,
                    maxHeight: 160,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {installerState.installLog || 'starting installer…'}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      <div className="onboarding-step-actions">
        <button type="button" onClick={onSkip} disabled={accepting}>
          Skip — use cloud provider
        </button>
        {!probing && probe && !probe.running && installerState.installers.length > 0 && (
          <button
            type="button"
            className="btn"
            disabled={installerState.installing || installerState.selected === null}
            onClick={() => void handleInstall()}
          >
            {installerState.installing ? 'Installing…' : 'Install Ollama'}
          </button>
        )}
        {!probing && probe?.running && probe.models.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={accepting || selectedModelId === null}
            onClick={() => void handleAcceptLocalOnly()}
          >
            {accepting ? 'Finishing…' : 'Use Ollama only'}
          </button>
        )}
        <button type="button" onClick={onContinueCloud} disabled={accepting}>
          Continue to provider setup
        </button>
      </div>
    </div>
  );
}
