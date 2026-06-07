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
      <div className="settings-block">
        <div className="settings-toggle-row">
          <div>
            <div className="settings-field-label">Read-only chat mode</div>
            <div className="settings-block-hint">
              Block every write / execute / network tool call automatically. Useful for &ldquo;chat
              with my codebase&rdquo; without giving the agent write access.
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={readOnly} onChange={() => void toggle()} />
            <span>{readOnly ? 'On' : 'Off'}</span>
          </label>
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <div className="settings-field-label">Codebase search</div>
        <div className="settings-block-hint">
          The agent has the <code>search_codebase</code> tool — a ranked grep over the workspace
          that respects <code>.gitignore</code> and <code>.opencodexignore</code>. Vector + AST
          indexing is on the v0.1 backlog.
        </div>
      </div>

      {error && (
        <div role="alert" className="field-errors">
          Failed to update read-only mode: {error}
        </div>
      )}
    </div>
  );
}
