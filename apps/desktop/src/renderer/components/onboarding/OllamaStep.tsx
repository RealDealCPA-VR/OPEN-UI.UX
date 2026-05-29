import { useCallback, useEffect, useRef, useState } from 'react';
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

// Smallest by sizeGb wins; ties (or all-zero sizes) fall through to the first
// entry in /api/tags order so behavior is deterministic for the Todo spec.
export function pickSmallestModelId(models: ReadonlyArray<OllamaModelEntry>): string | null {
  if (models.length === 0) return null;
  let bestIdx = 0;
  let bestSize = models[0]?.sizeGb ?? 0;
  for (let i = 1; i < models.length; i++) {
    const entry = models[i];
    if (!entry) continue;
    if (entry.sizeGb > 0 && (bestSize <= 0 || entry.sizeGb < bestSize)) {
      bestIdx = i;
      bestSize = entry.sizeGb;
    }
  }
  return models[bestIdx]?.id ?? null;
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

  // useRef so runProbe's identity stays stable across re-renders triggered by
  // setSelectedModelId — otherwise the useEffect that calls runProbe would loop.
  const selectedModelIdRef = useRef<string | null>(null);
  selectedModelIdRef.current = selectedModelId;

  const runProbe = useCallback(async () => {
    setProbing(true);
    const ollama = window.opencodex?.ollama;
    if (!ollama?.probe) {
      setProbe({
        running: false,
        models: [],
        error: 'Ollama bridge unavailable in this build.',
      });
      setProbing(false);
      return;
    }
    try {
      const result = await ollama.probe();
      setProbe(result);
      if (result.running && result.models.length > 0 && selectedModelIdRef.current === null) {
        // Default to the smallest installed model so the first run actually
        // streams on modest hardware instead of OOM-ing on a 70B.
        const pick = pickSmallestModelId(result.models);
        if (pick) setSelectedModelId(pick);
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
  }, []);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  useEffect(() => {
    let cancelled = false;
    const ollama = window.opencodex?.ollama;
    if (!ollama?.listInstallableManagers) return;
    void ollama
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
    const ollama = window.opencodex?.ollama;
    if (!ollama?.onInstallProgress) return;
    const off = ollama.onInstallProgress((payload: OllamaInstallProgress) => {
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
            title="Skip provider setup — start chatting now with Ollama only"
          >
            {accepting ? 'Finishing…' : 'Skip provider setup — use Ollama'}
          </button>
        )}
        <button type="button" onClick={onContinueCloud} disabled={accepting}>
          Continue to provider setup
        </button>
      </div>
    </div>
  );
}
