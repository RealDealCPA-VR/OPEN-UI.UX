import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunnerInfo, RunnerInstallCheck } from '../../../shared/ipc-types';

export interface RunnersStepProps {
  runners: RunnerInfo[];
  installStatuses: Map<string, RunnerInstallCheck>;
  onRefreshStatuses: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

const KNOWN_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'claude-code': "Anthropic's Claude Code CLI",
  opencode: 'The OpenCode harness',
  aider: 'Aider AI pair programmer',
};

function describeRunner(runner: RunnerInfo): string {
  return KNOWN_DESCRIPTIONS[runner.id] ?? runner.displayName;
}

function isExternalRunner(runner: RunnerInfo): boolean {
  return runner.source === 'plugin' || runner.id !== 'internal';
}

export function RunnersStep({
  runners,
  installStatuses,
  onRefreshStatuses,
  onSkip,
  onContinue,
}: RunnersStepProps): JSX.Element {
  const navigate = useNavigate();

  useEffect(() => {
    const off = window.opencodex.agent.onRunnersChanged(() => {
      onRefreshStatuses();
    });
    return () => {
      off();
    };
  }, [onRefreshStatuses]);

  const externalRunners = runners.filter(isExternalRunner);

  return (
    <div className="onboarding-step">
      <h3>Connect a coding agent</h3>
      <p className="onboarding-step-desc">
        Optional: connect an external coding agent like Claude Code or OpenCode. Skip if you only
        need the built-in agent — you can always add one later from the Runners panel.
      </p>
      <p className="onboarding-why">
        Why? External runners bring their own provider, tools, and approval model. Changes land in a
        git worktree so you stay in control.
      </p>

      {externalRunners.length === 0 ? (
        <p className="settings-section-desc">
          No external runners available. The built-in agent is always ready.
        </p>
      ) : (
        <ul className="onboarding-provider-list">
          {externalRunners.map((runner) => {
            const status = installStatuses.get(runner.id);
            const installed = status?.ok === true;
            const sourceLabel =
              runner.source === 'plugin' ? (runner.pluginId ?? 'plugin') : 'external';
            return (
              <li key={runner.id}>
                <div className="onboarding-provider-row">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="pill">{sourceLabel}</span>
                      <strong>{runner.displayName}</strong>
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
                    {!installed && (
                      <span
                        className="settings-section-desc"
                        style={{ marginLeft: 0, fontSize: 12 }}
                      >
                        {describeRunner(runner)}
                      </span>
                    )}
                  </div>
                  {!installed && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => navigate(`/runners?install=${runner.id}`)}
                    >
                      Install
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="onboarding-step-actions">
        <button type="button" onClick={onSkip}>
          Skip for now
        </button>
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
