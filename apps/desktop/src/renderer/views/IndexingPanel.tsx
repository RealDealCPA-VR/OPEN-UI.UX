export function IndexingPanel(): JSX.Element {
  return (
    <div className="indexing-panel indexing-panel-stub">
      <div className="indexing-stub-head">
        <span className="pill pill-soon">Coming in Phase 3</span>
      </div>
      <p className="indexing-stub-desc">
        Codebase indexing isn’t wired up yet. When Phase 3 ships, this section will let you:
      </p>
      <ul className="indexing-stub-list">
        <li>Pick an embedding provider (OpenAI, Voyage, or local Ollama)</li>
        <li>See indexed file count, last-update time, and any errors</li>
        <li>Manually trigger a reindex of the active workspace</li>
        <li>
          Configure <code>.opencodexignore</code> overrides on top of <code>.gitignore</code>
        </li>
      </ul>
      <p className="indexing-stub-foot">
        Until then, the agent has access to <code>read_file</code>, <code>glob</code>, and{' '}
        <code>grep</code> — which cover most lookup needs without an index.
      </p>
    </div>
  );
}
