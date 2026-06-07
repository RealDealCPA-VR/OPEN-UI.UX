import { useEffect, useState } from 'react';

export function NotificationsPanel(): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.opencodex.settings
      .getAgentRunNotificationsEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = window.opencodex.settings.onAgentRunNotificationsChanged((value) => {
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
      await window.opencodex.settings.setAgentRunNotificationsEnabled(next);
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
        Failed to load notification settings: {loadError}
      </div>
    );
  }
  if (enabled === null) {
    return <p className="notifications-loading settings-skeleton">Loading…</p>;
  }

  return (
    <div className="notifications-panel">
      <div className="settings-block">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void handleToggle(e.target.checked)}
            disabled={saving}
          />
          <span>Agent run notifications</span>
        </label>
        <p className="settings-block-hint">
          Show an OS notification when a run you started finishes, fails, or a worktree run is ready
          to review. Suppressed while OpenCodex is focused.
        </p>
        {saveError && (
          <p className="field-errors" role="alert">
            Failed: {saveError}
          </p>
        )}
      </div>
    </div>
  );
}
