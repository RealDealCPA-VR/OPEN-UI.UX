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
    return <p className="theme-error">Failed to load theme: {loadError}</p>;
  }
  if (!preference) {
    return <p className="theme-loading">Loading…</p>;
  }

  return (
    <div className="theme-panel">
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
      {saveError && <p className="theme-action-error">Failed: {saveError}</p>}
    </div>
  );
}

function ThemeSwatch({ value }: { value: ThemePreference }): JSX.Element {
  if (value === 'light') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 28,
          height: 18,
          borderRadius: 4,
          border: '1px solid var(--border)',
          marginRight: 10,
          background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
          flexShrink: 0,
        }}
      />
    );
  }
  if (value === 'dark') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 28,
          height: 18,
          borderRadius: 4,
          border: '1px solid var(--border)',
          marginRight: 10,
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          flexShrink: 0,
        }}
      />
    );
  }
  // System: split-tone swatch.
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 28,
        height: 18,
        borderRadius: 4,
        border: '1px solid var(--border)',
        marginRight: 10,
        background: 'linear-gradient(135deg, #f8fafc 0%, #f8fafc 49%, #0f172a 51%, #0f172a 100%)',
        flexShrink: 0,
      }}
    />
  );
}
