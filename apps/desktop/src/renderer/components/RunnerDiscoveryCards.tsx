import type { RunnerInfo, RunnerInstallCheck } from '../../shared/ipc-types';

export interface RunnerDiscoveryCardsProps {
  runners: RunnerInfo[];
  installStatuses: Map<string, RunnerInstallCheck>;
  onSpawn: (runnerId: string) => void;
  onSetup: (runnerId: string) => void;
}

const KNOWN_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'claude-code': "Anthropic's Claude Code CLI",
  opencode: 'The OpenCode harness',
  aider: 'Aider AI pair programmer',
};

function describeRunner(runner: RunnerInfo): string {
  return KNOWN_DESCRIPTIONS[runner.id] ?? runner.displayName;
}

const STYLES = `
  .runner-discovery-row {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding: 4px 2px 12px;
    margin: 0;
    list-style: none;
  }
  .runner-discovery-row.runner-discovery-wrap {
    flex-wrap: wrap;
    overflow-x: visible;
  }
  .runner-discovery-card {
    flex: 0 0 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border, #2a2a32);
    border-radius: 8px;
    background: var(--bg-pill, rgba(255, 255, 255, 0.02));
  }
  .runner-discovery-card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .runner-discovery-card-name {
    font-weight: 600;
    font-size: 13px;
  }
  .runner-discovery-card-desc {
    font-size: 12px;
    color: var(--text-muted, #98a0aa);
    line-height: 1.4;
    flex: 1;
  }
  .runner-discovery-card-actions {
    display: flex;
    justify-content: flex-end;
  }
`;

export function RunnerDiscoveryCards({
  runners,
  installStatuses,
  onSpawn,
  onSetup,
}: RunnerDiscoveryCardsProps): JSX.Element {
  const externals = runners.filter((r) => r.source === 'plugin' || r.id !== 'internal');
  const totalCards = externals.length + 1;
  const useWrap = totalCards < 4;

  return (
    <>
      <style>{STYLES}</style>
      <ul className={`runner-discovery-row ${useWrap ? 'runner-discovery-wrap' : ''}`.trim()}>
        <li className="runner-discovery-card" key="internal">
          <div className="runner-discovery-card-head">
            <span className="pill">Built-in</span>
            <span className="runner-discovery-card-name">OpenCodex internal</span>
            <span className="pill pill-ok">always installed</span>
          </div>
          <p className="runner-discovery-card-desc">
            The built-in agent loop — your provider, your tools, your approval policy.
          </p>
          <div className="runner-discovery-card-actions">
            <button type="button" className="btn btn-primary" onClick={() => onSpawn('internal')}>
              Spawn task
            </button>
          </div>
        </li>

        {externals.map((runner) => {
          const status = installStatuses.get(runner.id);
          const installed = status?.ok === true;
          const sourceLabel =
            runner.source === 'plugin' ? (runner.pluginId ?? 'plugin') : 'external';
          return (
            <li className="runner-discovery-card" key={runner.id}>
              <div className="runner-discovery-card-head">
                <span className="pill">{sourceLabel}</span>
                <span className="runner-discovery-card-name">{runner.displayName}</span>
                {installed ? (
                  <span className="pill pill-ok">
                    installed{status?.version ? ` · ${status.version}` : ''}
                  </span>
                ) : (
                  <span className="pill pill-warn" title={status?.hint ?? 'Not installed'}>
                    not installed
                  </span>
                )}
              </div>
              <p className="runner-discovery-card-desc">{describeRunner(runner)}</p>
              <div className="runner-discovery-card-actions">
                {installed ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onSpawn(runner.id)}
                  >
                    Spawn with {runner.displayName}
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => onSetup(runner.id)}>
                    Set up
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
