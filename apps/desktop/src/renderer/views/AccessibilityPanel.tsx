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
    return <p className="theme-error">Failed to load accessibility settings: {loadError}</p>;
  }
  if (enabled === null) {
    return <p className="theme-loading">Loading…</p>;
  }

  return (
    <div className="accessibility-panel">
      <label className="accessibility-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void handleToggle(e.target.checked)}
          disabled={saving}
        />
        <span className="accessibility-toggle-text">
          <span className="accessibility-toggle-name">Hover hints</span>
          <span className="accessibility-toggle-desc">
            Show short helper bubbles when hovering or focusing UI controls.
          </span>
        </span>
      </label>

      {saveError && <p className="theme-action-error">Failed: {saveError}</p>}

      <div className="accessibility-row">
        <div>
          <div style={{ fontWeight: 500 }}>Reduced motion</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            OpenCodex honors your OS preference automatically. Animations are dampened when reduced
            motion is on.
          </div>
        </div>
        <span
          className={`pill ${reducedMotion ? 'pill-ok' : ''}`}
          aria-live="polite"
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--border)',
            color: reducedMotion ? 'var(--success)' : 'var(--text-muted)',
            background: reducedMotion ? 'var(--success-bg)' : 'transparent',
          }}
        >
          Detected from OS: {reducedMotion ? 'reduced' : 'default'}
        </span>
      </div>

      <div className="accessibility-preview">
        <h3 className="accessibility-preview-title">Preview</h3>
        <p className="accessibility-preview-desc">
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
