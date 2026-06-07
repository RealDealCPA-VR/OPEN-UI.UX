import { useCallback, useEffect, useState } from 'react';

export function AntiSycophancyToggle(): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await window.opencodex.antiSycophancy.get();
        if (!cancelled) setEnabled(value);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = useCallback(async (next: boolean) => {
    setPending(true);
    setError(null);
    try {
      const saved = await window.opencodex.antiSycophancy.set(next);
      setEnabled(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, []);

  return (
    <div data-settings-anchor="anti-sycophancy">
      <div className="settings-block">
        <h3 className="settings-subhead">Honest mode</h3>
        <p className="settings-block-hint">
          When on, the agent is instructed to push back on incorrect premises before doing the task,
          to disagree when it has grounds, and to skip validation-seeking language. Applies to both
          the chat agent and the orchestrator.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled ?? true}
            disabled={enabled === null || pending}
            onChange={(e) => void onToggle(e.target.checked)}
          />
          <span>Push back on incorrect premises and skip validation-seeking language</span>
        </label>
      </div>
      {error !== null && (
        <div role="alert" className="field-errors">
          {error}
        </div>
      )}
    </div>
  );
}
