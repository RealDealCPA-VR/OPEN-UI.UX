import { useEffect, useState } from 'react';

export function IndexingPanel(): JSX.Element {
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.opencodex.chat.getReadOnlyMode().then(({ readOnly: r }) => setReadOnly(r));
    return window.opencodex.chat.onReadOnlyChanged(({ readOnly: r }) => setReadOnly(r));
  }, []);

  const toggle = async (): Promise<void> => {
    const next = !readOnly;
    const prev = readOnly;
    setReadOnly(next);
    setError(null);
    try {
      await window.opencodex.chat.setReadOnlyMode(next);
    } catch (err) {
      setReadOnly(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="indexing-panel">
      <div className="indexing-row">
        <div>
          <div className="indexing-label">Read-only chat mode</div>
          <div className="settings-section-desc">
            Block every write / execute / network tool call automatically. Useful for &ldquo;chat
            with my codebase&rdquo; without giving the agent write access.
          </div>
        </div>
        <label className="indexing-toggle">
          <input type="checkbox" checked={readOnly} onChange={() => void toggle()} />
          <span>{readOnly ? 'On' : 'Off'}</span>
        </label>
      </div>
      <div className="indexing-row indexing-search">
        <div>
          <div className="indexing-label">Codebase search</div>
          <div className="settings-section-desc">
            The agent has the <code>search_codebase</code> tool — a ranked grep over the workspace
            that respects <code>.gitignore</code> and <code>.opencodexignore</code>. Vector + AST
            indexing is on the v0.1 backlog.
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: 10,
            background: 'var(--danger-bg, rgba(220,38,38,0.08))',
            color: 'var(--danger, #dc2626)',
            border: '1px solid var(--danger-border, rgba(220,38,38,0.3))',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Failed to update read-only mode: {error}
        </div>
      )}
    </div>
  );
}
