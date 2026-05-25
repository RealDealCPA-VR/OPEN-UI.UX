import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProviderListItem } from '../../shared/provider-config';
import type { WorkspaceState } from '../../shared/workspace';
import { useSelectedModel } from '../state/selected-model-context';

type Step = 'provider' | 'apikey' | 'workspace' | 'done';

export function OnboardingWizard(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('provider');
  const [chosenProviderId, setChosenProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { providers, configuredProviders, loading, reload } = useSelectedModel();
  const navigate = useNavigate();

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
    await window.opencodex.onboarding.setComplete(true);
    setOpen(false);
    navigate('/chat');
  }, [navigate]);

  const chosenProvider = useMemo<ProviderListItem | null>(
    () => providers.find((p) => p.info.id === chosenProviderId) ?? null,
    [providers, chosenProviderId],
  );

  if (!open) return null;
  if (loading) return null;

  const dismiss = (): void => {
    void window.opencodex.onboarding.setComplete(true);
    setOpen(false);
  };

  return (
    <div className="onboarding-wizard-overlay" role="dialog" aria-label="Welcome">
      <div className="onboarding-wizard">
        <header className="onboarding-wizard-head">
          <h2>Welcome to OpenCodex</h2>
          <button type="button" className="onboarding-wizard-skip" onClick={dismiss}>
            Skip
          </button>
        </header>
        {error && <div className="onboarding-wizard-error">{error}</div>}
        {step === 'provider' && (
          <ProviderStep
            providers={providers}
            chosenId={chosenProviderId}
            onChoose={setChosenProviderId}
            onNext={() => setStep('apikey')}
          />
        )}
        {step === 'apikey' && chosenProvider && (
          <ApiKeyStep
            provider={chosenProvider}
            apiKey={apiKey}
            setApiKey={setApiKey}
            busy={busy}
            onBack={() => setStep('provider')}
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
                reload();
                setStep('workspace');
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {step === 'workspace' && (
          <WorkspaceStep
            workspace={workspace}
            busy={busy}
            onBack={() => setStep('apikey')}
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
            onSkipWorkspace={() => setStep('done')}
            onNext={() => setStep('done')}
            configuredCount={configuredProviders.length}
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
}: {
  providers: ProviderListItem[];
  chosenId: string | null;
  onChoose(id: string): void;
  onNext(): void;
}): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>Pick a provider</h3>
      <p className="onboarding-step-desc">
        Choose the LLM you want to start with. You can add more in Settings later.
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
              />
              <span>{p.info.displayName}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="onboarding-step-actions">
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
  onNext,
}: {
  provider: ProviderListItem;
  apiKey: string;
  setApiKey(v: string): void;
  busy: boolean;
  onBack(): void;
  onNext(): void;
}): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>Add your {provider.info.displayName} API key</h3>
      <p className="onboarding-step-desc">
        Stored in your OS keychain. Never written to disk, never sent anywhere except{' '}
        {provider.info.displayName}.
      </p>
      <input
        type="password"
        autoFocus
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={provider.info.requiresApiKey ? 'sk-…' : '(optional)'}
        className="onboarding-apikey"
      />
      <div className="onboarding-step-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          disabled={busy || (provider.info.requiresApiKey && !apiKey)}
          onClick={onNext}
        >
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

function DoneStep({ onFinish }: { onFinish(): void }): JSX.Element {
  return (
    <div className="onboarding-step">
      <h3>You&apos;re ready</h3>
      <p className="onboarding-step-desc">
        That&apos;s it — start chatting, or tweak more in Settings (approvals, MCP servers, audit
        log, theme).
      </p>
      <div className="onboarding-step-actions">
        <button type="button" className="btn btn-primary" onClick={onFinish}>
          Start chatting
        </button>
      </div>
    </div>
  );
}
