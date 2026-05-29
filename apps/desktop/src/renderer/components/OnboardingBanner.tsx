import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelectedModel } from '../state/selected-model-context';

const PROVIDERS_SECTION_ID = 'settings-providers';
const PROVIDERS_ROUTE = '/settings/providers';

const TOTAL_STEPS = 4;

export function OnboardingBanner(): JSX.Element | null {
  const { configuredProviders, loading, error } = useSelectedModel();
  const navigate = useNavigate();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [workspaceActive, setWorkspaceActive] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.onboarding.getState().then((s) => {
      if (!cancelled) setOnboardingComplete(s.complete);
    });
    void window.opencodex.workspace.get().then((w) => {
      if (!cancelled) setWorkspaceActive(Boolean(w.active));
    });
    const off = window.opencodex.workspace.onChanged((evt) => {
      if (!cancelled) setWorkspaceActive(Boolean(evt.state.active));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const goToProviders = useCallback(() => {
    navigate(PROVIDERS_ROUTE);
  }, [navigate]);

  const resumeSetup = useCallback(async () => {
    try {
      await window.opencodex.onboarding.setComplete(false);
    } catch {
      // best-effort
    }
    window.dispatchEvent(new CustomEvent('opencodex:onboarding:resume'));
  }, []);

  if (loading || error) return null;
  if (onboardingComplete === null) return null;
  if (onboardingComplete === true) return null;
  if (configuredProviders.length > 0 && workspaceActive) return null;

  // Compute step progress: provider chosen, key present, workspace set.
  // Skills step counts as done if any provider+key is configured (proxy).
  const providerDone = configuredProviders.length > 0;
  const keyDone = providerDone; // key presence is implied by "configured"
  const workspaceDone = workspaceActive;
  const stepsDone = Number(providerDone) + Number(keyDone) + Number(workspaceDone) + Number(false);

  return (
    <aside
      className="onboarding-banner"
      role="region"
      aria-label="Welcome"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div className="onboarding-banner-text" style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 className="onboarding-banner-title" style={{ margin: 0 }}>
            Welcome to OpenCodex
          </h2>
          <span
            aria-label={`Setup progress: ${stepsDone} of ${TOTAL_STEPS} steps complete`}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'var(--bg-elevated, rgba(255,255,255,0.06))',
              color: 'var(--text-muted, #98a0aa)',
              border: '1px solid var(--border, #2a2a32)',
            }}
          >
            {stepsDone} of {TOTAL_STEPS} done
          </span>
        </div>
        <p className="onboarding-banner-desc">
          {!providerDone
            ? 'To start chatting, add an API key for at least one provider. Keys stay in your OS keychain and never leave this machine.'
            : !workspaceDone
              ? 'You can finish onboarding any time — pick a workspace folder so the agent has a sandbox.'
              : 'Resume the welcome flow to install starter skills or finish onboarding.'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!providerDone ? (
          <button type="button" className="btn btn-primary" onClick={goToProviders}>
            Configure a provider
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => void resumeSetup()}
          aria-label="Resume setup"
        >
          Resume setup
        </button>
      </div>
    </aside>
  );
}

export { PROVIDERS_ROUTE, PROVIDERS_SECTION_ID };
