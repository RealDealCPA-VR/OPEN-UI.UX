import { useCallback, useEffect, useState } from 'react';
import { THEME_OPTIONS, type ThemePreference } from '../../shared/theme';

export function ThemePanel(): JSX.Element {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.theme
      .get()
      .then((p) => {
        if (!cancelled) setPreference(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(async (next: ThemePreference) => {
    setSaving(next);
    setSaveError(null);
    try {
      const applied = await window.opencodex.theme.set({ preference: next });
      setPreference(applied);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving((s) => (s === next ? null : s));
    }
  }, []);

  if (loadError) {
    return (
      <p className="field-errors" role="alert">
        Failed to load theme: {loadError}
      </p>
    );
  }
  if (!preference) {
    return <p className="theme-loading">Loading…</p>;
  }

  return (
    <div className="theme-panel">
      <div className="settings-block">
        <ul className="theme-options">
          {THEME_OPTIONS.map((opt) => {
            const selected = preference === opt.value;
            return (
              <li key={opt.value} className="theme-option">
                <label className={`theme-option-label${selected ? ' theme-option-selected' : ''}`}>
                  <input
                    type="radio"
                    name="theme-preference"
                    value={opt.value}
                    checked={selected}
                    onChange={() => void handleSelect(opt.value)}
                    disabled={saving !== null}
                  />
                  <ThemeSwatch value={opt.value} />
                  <span className="theme-option-text">
                    <span className="theme-option-name">{opt.label}</span>
                    <span className="theme-option-desc">{opt.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {saveError && (
          <p className="field-errors" role="alert">
            Failed: {saveError}
          </p>
        )}
      </div>
    </div>
  );
}

const SWATCH_SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// A distinct line icon per theme so the options are instantly recognizable:
// sun = light, moon = dark, monitor = follow the system.
function ThemeSwatch({ value }: { value: ThemePreference }): JSX.Element {
  if (value === 'light') {
    return (
      <svg className="theme-swatch" aria-hidden="true" {...SWATCH_SVG_PROPS}>
        <circle cx="12" cy="12" r="4.25" />
        <path d="M12 2.5v2.25M12 19.25v2.25M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.25M19.25 12h2.25M4.4 19.6l1.6-1.6M18 6l1.6-1.6" />
      </svg>
    );
  }
  if (value === 'dark') {
    return (
      <svg className="theme-swatch" aria-hidden="true" {...SWATCH_SVG_PROPS}>
        <path d="M20.5 14.2A8 8 0 1 1 9.8 3.5a6.25 6.25 0 0 0 10.7 10.7z" />
      </svg>
    );
  }
  // System: a monitor — the agent follows the OS appearance.
  return (
    <svg className="theme-swatch" aria-hidden="true" {...SWATCH_SVG_PROPS}>
      <rect x="2.75" y="4.5" width="18.5" height="12" rx="1.75" />
      <path d="M9 20.25h6M12 16.5v3.75" />
    </svg>
  );
}
