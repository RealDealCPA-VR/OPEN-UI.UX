import { useEffect, useState } from 'react';
import { HoverHint } from '../components/HoverHint';

export function AccessibilityPanel(): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

      <div className="accessibility-preview">
        <h4 className="accessibility-preview-title">Preview</h4>
        <p className="accessibility-preview-desc">
          Hover or focus the button below to see a hint when the setting is enabled.
        </p>
        <HoverHint hint="Demo hint">
          <button type="button" className="btn">
            Hover me
          </button>
        </HoverHint>
      </div>
    </div>
  );
}
