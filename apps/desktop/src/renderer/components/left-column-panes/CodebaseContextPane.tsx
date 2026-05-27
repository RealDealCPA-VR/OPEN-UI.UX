export default function CodebaseContextPane(): JSX.Element {
  // TODO(phase10): recent-files history — requires lifting state out of CodebaseView,
  // which is owned by another wave. Placeholder shown until that lift lands.
  return (
    <div className="lcc-pane lcc-pane-codebase">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Recent files</span>
      </div>
      <p className="lcc-pane-empty">Recent files will appear here.</p>
    </div>
  );
}
