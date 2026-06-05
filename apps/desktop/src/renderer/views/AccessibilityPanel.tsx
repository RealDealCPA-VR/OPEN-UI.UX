import { useEffect, useState } from 'react';
import { HoverHint } from '../components/HoverHint';
import { VoiceSettingsSection } from '../components/VoiceSettingsSection';

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AccessibilityPanel(): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => detectReducedMotion());

  useEffect(() => {
    let cancelled = false;
    window.opencodex.settings
      .getHoverHintsEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.settings.onHoverHintsChanged((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent): void => setReducedMotion(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Older Safari fallback.
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const handleToggle = async (next: boolean): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await window.opencodex.settings.setHoverHintsEnabled(next);
      setEnabled(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div role="alert" className="field-errors">
        Failed to load accessibility settings: {loadError}
      </div>
    );
  }
  if (enabled === null) {
    return <p className="accessibility-loading settings-skeleton">Loading…</p>;
  }

  return (
    <div className="accessibility-panel">
      <div className="settings-block">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void handleToggle(e.target.checked)}
            disabled={saving}
          />
          <span>Hover hints</span>
        </label>
        <p className="settings-block-hint">
          Show short helper bubbles when hovering or focusing UI controls.
        </p>
        {saveError && (
          <p className="field-errors" role="alert">
            Failed: {saveError}
          </p>
        )}
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <div className="settings-toggle-row">
          <div>
            <div className="settings-field-label">Reduced motion</div>
            <p className="settings-block-hint">
              OpenCodex honors your OS preference automatically. Animations are dampened when
              reduced motion is on.
            </p>
          </div>
          <span className={`pill${reducedMotion ? ' pill-ok' : ''}`} aria-live="polite">
            Detected from OS: {reducedMotion ? 'reduced' : 'default'}
          </span>
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <h3 className="settings-subhead">Preview</h3>
        <p className="settings-block-hint">
          Hover or focus the button below to see a hint when the setting is enabled.
        </p>
        <HoverHint hint="Demo hint">
          <button type="button" className="btn">
            Hover me
          </button>
        </HoverHint>
      </div>
      <VoiceSettingsSection />
    </div>
  );
}
