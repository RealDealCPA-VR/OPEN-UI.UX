import { RunnersPanel } from './RunnersPanel';

export function RunnersView(): JSX.Element {
  return (
    <section className="view runners-view">
      <header className="runners-view-header">
        <div>
          <h1>Runners</h1>
          <p>
            Pick which agent harness runs your tasks. Built-in uses OpenCodex&apos;s in-process
            loop; plugin runners delegate to external CLIs (Claude Code, OpenCode, Aider) with their
            own provider, tools, and approvals.
          </p>
        </div>
      </header>
      <RunnersPanel />
    </section>
  );
}
