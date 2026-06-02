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
    <div className="approvals-subsection" data-settings-anchor="anti-sycophancy">
      <h3 className="approvals-subhead">Honest mode</h3>
      <p className="approvals-subhead-desc">
        When on, the agent is instructed to push back on incorrect premises before doing the task,
        to disagree when it has grounds, and to skip validation-seeking language. Applies to both
        the chat agent and the orchestrator.
      </p>
      <label
        className="toggle"
        style={{
          padding: '8px 0',
          cursor: enabled === null || pending ? 'progress' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={enabled ?? true}
          disabled={enabled === null || pending}
          onChange={(e) => void onToggle(e.target.checked)}
        />
        <span>Push back on wrong premises (default: on)</span>
      </label>
      {error !== null && (
        <div
          role="alert"
          style={{
            marginTop: 6,
            padding: 8,
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
