import { useEffect, useState } from 'react';

export function IndexingPanel(): JSX.Element {
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    void window.opencodex.chat.getReadOnlyMode().then(({ readOnly: r }) => setReadOnly(r));
    return window.opencodex.chat.onReadOnlyChanged(({ readOnly: r }) => setReadOnly(r));
  }, []);

  const toggle = async (): Promise<void> => {
    const next = !readOnly;
    setReadOnly(next);
    await window.opencodex.chat.setReadOnlyMode(next);
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
    </div>
  );
}
