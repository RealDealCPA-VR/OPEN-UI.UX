import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProviderListItem } from '../../shared/provider-config';
import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';
import type { WorkspaceState } from '../../shared/workspace';
import { useSelectedModel } from '../state/selected-model-context';
import { OllamaStep } from './onboarding/OllamaStep';
import { RunnersStep } from './onboarding/RunnersStep';

type Step = 'ollama' | 'provider' | 'apikey' | 'runners' | 'workspace' | 'skills' | 'done';

const VISIBLE_STEPS: readonly Step[] = [
  'ollama',
  'provider',
  'apikey',
  'runners',
  'workspace',
  'skills',
];

const STARTER_SKILLS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'daily-standup', description: 'Summarize recent git activity in a standup-style report' },
  {
    name: 'security-audit',
    description: 'Scan for hardcoded secrets, weak crypto, injection holes',
  },
  { name: 'dependency-check', description: 'Outdated deps + GitHub Advisory CVE lookup' },
];

const STYLES = `
  .onboarding-progress {
    display: flex;
    gap: 6px;
    margin: 0 0 14px;
    list-style: none;
    padding: 0;
  }
  .onboarding-progress li {
    flex: 1;
    height: 4px;
    background: var(--border, #2a2a32);
    border-radius: 999px;
    transition: background 200ms ease;
  }
  .onboarding-progress li[data-state="done"] {
    background: var(--accent, #6366f1);
  }
  .onboarding-progress li[data-state="current"] {
    background: var(--accent-soft, rgba(99,102,241,0.55));
  }
  .onboarding-why {
    font-size: 12px;
    color: var(--text-muted, #98a0aa);
    margin: -6px 0 12px;
    line-height: 1.45;
  }
  .onboarding-step-error {
    background: var(--danger-bg, rgba(220, 38, 38, 0.08));
    color: var(--danger, #dc2626);
    border: 1px solid var(--danger-border, rgba(220, 38, 38, 0.3));
    border-radius: 6px;
    padding: 8px 10px;
    margin: 8px 0;
    font-size: 13px;
    line-height: 1.4;
  }
  .onboarding-step-error-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .onboarding-step-error-actions button {
    background: transparent;
    border: 1px solid currentColor;
    color: inherit;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .onboarding-success-check {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--success-bg, rgba(34, 197, 94, 0.12));
    color: var(--success, #22c55e);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 12px;
    animation: onboarding-check-in 380ms ease-out 1;
  }
  .onboarding-success-check svg {
    width: 22px;
    height: 22px;
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: onboarding-check-draw 360ms 120ms ease-out forwards;
  }
  @keyframes onboarding-check-in {
    from { transform: scale(0.6); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  @keyframes onboarding-check-draw {
    to { stroke-dashoffset: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .onboarding-success-check { animation: none; }
    .onboarding-success-check svg { animation: none; stroke-dashoffset: 0; }
  }
`;

export function OnboardingWizard(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('ollama');
  const [chosenProviderId, setChosenProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [selectedStarterSkills, setSelectedStarterSkills] = useState<Set<string>>(
    () => new Set(STARTER_SKILLS.map((s) => s.name)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runners, setRunners] = useState<RunnerInfo[]>([]);
  const [installStatuses, setInstallStatuses] = useState<Map<string, RunnerInstallCheck>>(
    () => new Map(),
  );

  const { providers, configuredProviders, loading, reload } = useSelectedModel();
  const navigate = useNavigate();

  const refreshRunners = useCallback(async () => {
    try {
      const list = await window.opencodex.agent.listRunners();
      setRunners(list);
      const entries = await Promise.all(
        list.map(async (r) => {
          try {
            const status = await window.opencodex.agent.checkRunnerInstalled(r.id);
            return [r.id, status] as const;
          } catch {
            return [
              r.id,
              { ok: false, hint: 'Status check failed' } as RunnerInstallCheck,
            ] as const;
          }
        }),
      );
      setInstallStatuses(new Map(entries));
    } catch {
      // Non-fatal — the runners step is optional. Leave empty state.
    }
  }, []);

  useEffect(() => {
    // refreshRunners is async; setState happens in the awaited continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRunners();
  }, [refreshRunners]);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.onboarding.getState().then(({ complete }) => {
      if (cancelled) return;
      if (!complete) setOpen(true);
    });
    void window.opencodex.workspace.get().then((s) => {
      if (cancelled) return;
      setWorkspace(s);
    });
    const unsub = window.opencodex.workspace.onChanged((evt) => setWorkspace(evt.state));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const finish = useCallback(async () => {
    if (selectedStarterSkills.size > 0) {
      try {
        await window.opencodex.skills.installStarterPack(Array.from(selectedStarterSkills));
      } catch {
        // not fatal — user can install later from Settings → Skills
      }
    }
    await window.opencodex.onboarding.setComplete(true);
    setOpen(false);
    navigate('/chat');
  }, [navigate, selectedStarterSkills]);

  const chosenProvider = useMemo<ProviderListItem | null>(
    () => providers.find((p) => p.info.id === chosenProviderId) ?? null,
    [providers, chosenProviderId],
  );

  if (!open) return null;
  if (loading) return null;

  const dismiss = (): void => {
    // Pause, don't complete: close the dialog without marking onboarding
    // complete. The banner picks up missing-provider / missing-workspace state
    // and offers "Resume setup". On next launch the wizard re-opens.
    setOpen(false);
    void window.opencodex.onboarding.setComplete(false).catch(() => undefined);
  };

  const stepIndex = VISIBLE_STEPS.indexOf(step as (typeof VISIBLE_STEPS)[number]);

  return (
    <div
      className="onboarding-wizard-overlay"
      role="dialog"
      aria-label="Welcome"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          dismiss();
        }
      }}
    >
      <style>{STYLES}</style>
      <div className="onboarding-wizard">
        <header className="onboarding-wizard-head">
          <h2>Welcome to OpenCodex</h2>
          <button
            type="button"
            className="onboarding-wizard-skip"
            onClick={dismiss}
            aria-label="Skip onboarding for now"
          >
            Skip for now
          </button>
        </header>

        <ol className="onboarding-progress" aria-label="Setup progress">
          {VISIBLE_STEPS.map((s, i) => {
            const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'pending';
            return <li key={s} data-state={state} />;
          })}
        </ol>

        {error && (
          <div className="onboarding-step-error" role="alert">
            <div>{error}</div>
            <div className="onboarding-step-error-actions">
              <button type="button" onClick={() => setError(null)}>
                Dismiss
              </button>
              {step === 'apikey' && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('provider');
                  }}
                >
                  Try a different provider
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'ollama' && (
          <OllamaStep
            onSkip={() => setStep('provider')}
            onContinueCloud={() => setStep('provider')}
            onAcceptLocalOnly={async (selectedModelId) => {
              try {
                await window.opencodex.providers.save({
                  id: 'ollama',
                  apiKey: null,
                  baseUrl: null,
                  extra: {},
                });
                if (selectedModelId) {
                  await window.opencodex.selectedModel.set({
                    providerId: 'ollama',
                    modelId: selectedModelId,
                  });
                }
                reload();
                await window.opencodex.onboarding.setComplete(true);
                setOpen(false);
                navigate('/chat');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        )}
        {step === 'provider' && (
          <ProviderStep
            providers={providers}
            chosenId={chosenProviderId}
            onChoose={setChosenProviderId}
            onNext={() => setStep('apikey')}
            onSkip={() => setStep('workspace')}
          />
        )}
        {step === 'apikey' && chosenProvider && (
          <ApiKeyStep
            provider={chosenProvider}
            apiKey={apiKey}
            setApiKey={setApiKey}
            busy={busy}
            onBack={() => setStep('provider')}
            onSkip={() => setStep('runners')}
            onNext={async () => {
              setBusy(true);
              setError(null);
              try {
                await window.opencodex.providers.save({
                  id: chosenProvider.info.id,
                  apiKey: apiKey || null,
                  baseUrl: null,
                  extra: {},
                });
                // If the provider exposes a connection-test, surface the real
                // provider error (not a generic "failed") inline.
                try {
                  const test = await window.opencodex.providers.test({
                    id: chosenProvider.info.id,
                  });
                  if (!test.ok) {
                    const code = test.httpStatus ? ` (HTTP ${test.httpStatus})` : '';
                    setError(
                      `${chosenProvider.info.displayName} rejected the key${code}: ${test.message}`,
                    );
                    setBusy(false);
                    return;
                  }
                } catch {
                  // Test endpoint missing or threw — proceed; the key still saved.
                }
                reload();
                setStep('runners');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {step === 'runners' && (
          <RunnersStep
            runners={runners}
            installStatuses={installStatuses}
            onRefreshStatuses={() => void refreshRunners()}
            onSkip={() => setStep('workspace')}
            onContinue={() => setStep('workspace')}
          />
        )}
        {step === 'workspace' && (
          <WorkspaceStep
            workspace={workspace}
            busy={busy}
            onBack={() => setStep('runners')}
            onBrowse={async () => {
              setBusy(true);
              setError(null);
              try {
                const next = await window.opencodex.workspace.browse();
                setWorkspace(next);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
            onSkipWorkspace={() => setStep('skills')}
            onNext={() => setStep('skills')}
            configuredCount={configuredProviders.length}
          />
        )}
        {step === 'skills' && (
          <SkillsStep
            selected={selectedStarterSkills}
            onToggle={(name) =>
              setSelectedStarterSkills((prev) => {
                const next = new Set(prev);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              })
            }
            onBack={() => setStep('workspace')}
            onSkip={() => {
              setSelectedStarterSkills(new Set());
              setStep('done');
            }}
            onNext={() => setStep('done')}
          />
        )}
        {step === 'done' && <DoneStep onFinish={() => void finish()} />}
      </div>
    </div>
  );
}

function ProviderStep({
  providers,
  chosenId,
  onChoose,
  onNext,
  onSkip,
}: {
  providers: ProviderListItem[];
  chosenId: string | null;
  onChoose(id: string): void;
  onNext(): void;
  onSkip(): void;
}): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>Pick a provider</h3>
      <p className="onboarding-step-desc">
        Choose the LLM you want to start with. You can add more in Settings later.
      </p>
      <p className="onboarding-why">
        Why? Different providers have different strengths and costs. You can switch any time.
      </p>
      <ul className="onboarding-provider-list">
        {providers.map((p) => (
          <li key={p.info.id}>
            <label className={`onboarding-provider-row ${chosenId === p.info.id ? 'chosen' : ''}`}>
              <input
                type="radio"
                name="provider"
                checked={chosenId === p.info.id}
                onChange={() => onChoose(p.info.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chosenId) onNext();
                }}
              />
              <span>{p.info.displayName}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="onboarding-step-actions">
        <button type="button" onClick={onSkip}>
          Skip this step
        </button>
        <button type="button" disabled={!chosenId} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  );
}

function ApiKeyStep({
  provider,
  apiKey,
  setApiKey,
  busy,
  onBack,
  onSkip,
  onNext,
}: {
  provider: ProviderListItem;
  apiKey: string;
  setApiKey(v: string): void;
  busy: boolean;
  onBack(): void;
  onSkip(): void;
  onNext(): void;
}): JSX.Element {
  const canContinue = !busy && (!provider.info.requiresApiKey || Boolean(apiKey));
  return (
    <div className="onboarding-step">
      <h3>Add your {provider.info.displayName} API key</h3>
      <p className="onboarding-step-desc">
        Stored in your OS keychain. Never written to disk, never sent anywhere except{' '}
        {provider.info.displayName}.
      </p>
      <p className="onboarding-why">
        Why? Your API key lives in the OS keychain (Keychain on macOS, Credential Vault on Windows,
        Secret Service on Linux) — never on disk and never synced.
      </p>
      <input
        type="password"
        autoFocus
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canContinue) onNext();
        }}
        placeholder={provider.info.requiresApiKey ? 'sk-…' : '(optional)'}
        className="onboarding-apikey"
      />
      <div className="onboarding-step-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={onSkip}>
          Skip
        </button>
        <button type="button" disabled={!canContinue} onClick={onNext}>
          {busy ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  );
}

function WorkspaceStep({
  workspace,
  busy,
  onBack,
  onBrowse,
  onSkipWorkspace,
  onNext,
  configuredCount,
}: {
  workspace: WorkspaceState | null;
  busy: boolean;
  onBack(): void;
  onBrowse(): void;
  onSkipWorkspace(): void;
  onNext(): void;
  configuredCount: number;
}): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>Pick a workspace</h3>
      <p className="onboarding-step-desc">
        File-system tools (read, write, edit, glob, grep, run_shell) are sandboxed to this folder.
        You can change it later in Settings.
      </p>
      <p className="onboarding-why">
        Why? A workspace boundary keeps the agent from reading or modifying anything outside the
        folder you choose.
      </p>
      {workspace?.active ? (
        <div className="onboarding-workspace-active">
          <code>{workspace.active}</code>
        </div>
      ) : (
        <p className="settings-section-desc">No workspace selected yet.</p>
      )}
      <div className="onboarding-step-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" disabled={busy} onClick={onBrowse}>
          {workspace?.active ? 'Pick another folder' : 'Browse…'}
        </button>
        <button type="button" onClick={workspace?.active ? onNext : onSkipWorkspace}>
          {workspace?.active ? 'Next' : 'Skip for now'}
        </button>
      </div>
      {configuredCount === 0 && (
        <p className="onboarding-warn">
          No providers configured yet — you can finish onboarding but won&apos;t be able to chat
          until you add an API key.
        </p>
      )}
    </div>
  );
}

function SkillsStep({
  selected,
  onToggle,
  onBack,
  onSkip,
  onNext,
}: {
  selected: Set<string>;
  onToggle(name: string): void;
  onBack(): void;
  onSkip(): void;
  onNext(): void;
}): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>Install starter skills?</h3>
      <p className="onboarding-step-desc">
        Skills are markdown templates that surface as <code>/skill:&lt;name&gt;</code> in chat. You
        can edit them anytime in Settings → Skills, or skip and install later.
      </p>
      <p className="onboarding-why">
        Why? Pre-built skills give you working examples to learn from. Disable any you don&apos;t
        need.
      </p>
      <ul className="onboarding-provider-list">
        {STARTER_SKILLS.map((s) => (
          <li key={s.name}>
            <label className="onboarding-provider-row">
              <input
                type="checkbox"
                checked={selected.has(s.name)}
                onChange={() => onToggle(s.name)}
              />
              <span>
                <code>{s.name}</code> — {s.description}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="onboarding-step-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={onSkip}>
          Skip all
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onNext();
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish(): void }): JSX.Element {
  return (
    <div className="onboarding-step" style={{ textAlign: 'center' }}>
      <div className="onboarding-success-check" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h3>Setup complete</h3>
      <p className="onboarding-step-desc">
        That&apos;s it — start chatting, or tweak more in Settings (approvals, MCP servers, audit
        log, theme).
      </p>
      <div className="onboarding-step-actions" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn-primary"
          autoFocus
          onClick={onFinish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinish();
          }}
        >
          Start chatting
        </button>
      </div>
    </div>
  );
}
