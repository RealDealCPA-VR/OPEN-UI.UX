import { useCallback } from 'react';
import { useSelectedModel } from '../state/selected-model-context';

const PROVIDERS_SECTION_ID = 'settings-providers';

export function OnboardingBanner(): JSX.Element | null {
  const { configuredProviders, loading, error } = useSelectedModel();

  const scrollToProviders = useCallback(() => {
    const el = document.getElementById(PROVIDERS_SECTION_ID);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const heading = el.querySelector('h2');
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  }, []);

  if (loading || error) return null;
  if (configuredProviders.length > 0) return null;

  return (
    <aside className="onboarding-banner" role="region" aria-label="Welcome">
      <div className="onboarding-banner-text">
        <h2 className="onboarding-banner-title">Welcome to OpenCodex</h2>
        <p className="onboarding-banner-desc">
          To start chatting, add an API key for at least one provider. Keys stay in your OS keychain
          and never leave this machine.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={scrollToProviders}>
        Configure a provider
      </button>
    </aside>
  );
}

export { PROVIDERS_SECTION_ID };
