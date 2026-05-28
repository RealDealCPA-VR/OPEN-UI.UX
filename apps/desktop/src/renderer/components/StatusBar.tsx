import { useEffect, useState } from 'react';
import { useChat } from '../state/chat-context';
import { useSelectedModel } from '../state/selected-model-context';
import {
  computeTokenMeterSegments,
  findRunningToolName,
  formatCostUsd,
  formatTokens,
  workspaceBasename,
} from './status-bar-derive';

type StatusState = 'idle' | 'streaming' | 'error';

export function StatusBar(): JSX.Element {
  const { streaming, draft, usage, error } = useChat();
  const { selectedCapabilities } = useSelectedModel();
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setActiveWorkspace(s.active);
      })
      .catch(() => {
        // Status bar is advisory; tolerate load errors.
      });
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setActiveWorkspace(payload.state.active);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const state: StatusState = error ? 'error' : streaming ? 'streaming' : 'idle';
  const runningTool = draft ? findRunningToolName(draft.blocks) : null;

  const tokensText = (() => {
    if (draft && draft.inputTokens !== null) {
      return formatTokens(draft.inputTokens, draft.outputTokens ?? 0);
    }
    if (usage && usage.messageCount > 0) {
      return formatTokens(usage.totalInputTokens, usage.totalOutputTokens);
    }
    return null;
  })();

  const costText = (() => {
    if (draft && draft.costUsd !== null) return formatCostUsd(draft.costUsd);
    if (usage && usage.totalCostUsd > 0) return formatCostUsd(usage.totalCostUsd);
    return null;
  })();

  const liveTokens = (() => {
    if (draft && draft.inputTokens !== null) {
      return (draft.inputTokens ?? 0) + (draft.outputTokens ?? 0);
    }
    if (usage && usage.messageCount > 0) {
      return usage.totalInputTokens + usage.totalOutputTokens;
    }
    return 0;
  })();

  const contextWindow = selectedCapabilities?.contextWindow ?? null;
  const meter =
    contextWindow && liveTokens > 0 ? computeTokenMeterSegments(liveTokens, contextWindow) : null;

  const handleWorkspaceClick = (): void => {
    if (!activeWorkspace) return;
    void window.opencodex.shell.showItemInFolder(activeWorkspace, activeWorkspace).catch(() => {
      // Best-effort: not all platforms can reveal a path; silently noop.
    });
  };

  return (
    <footer className={`statusbar statusbar-${state}`} role="status" aria-live="polite">
      <div className="statusbar-left">
        <span className={`statusbar-dot statusbar-dot-${state}`} aria-hidden="true" />
        <span className="statusbar-state">{stateLabel(state)}</span>
        {runningTool ? (
          <span className="statusbar-tool" title={`Running tool: ${runningTool}`}>
            <span className="statusbar-sep" aria-hidden="true">
              ›
            </span>
            <code
              className="statusbar-tool-name"
              style={
                streaming ? { animation: 'statusbar-pulse 1.2s ease-in-out infinite' } : undefined
              }
            >
              {runningTool}
            </code>
          </span>
        ) : null}
      </div>
      <div className="statusbar-right">
        {meter ? (
          <span
            className="statusbar-tokens"
            title={`${meter.tokens.toLocaleString()} / ${meter.context.toLocaleString()} tokens (${Math.round(meter.ratio * 100)}%)`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                width: 64,
                height: 6,
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-sunken)',
              }}
            >
              <span
                style={{
                  width: `${Math.min(100, meter.ratio * 100)}%`,
                  height: '100%',
                  background:
                    meter.ratio >= 0.9
                      ? 'var(--warn)'
                      : meter.ratio >= 0.7
                        ? 'var(--accent)'
                        : 'var(--success-strong, var(--accent))',
                  transition: 'width 200ms ease',
                }}
              />
            </span>
            <span className="statusbar-mono">{Math.round(meter.ratio * 100)}%</span>
            {costText ? <span className="statusbar-mono"> · {costText}</span> : null}
          </span>
        ) : tokensText ? (
          <span className="statusbar-tokens" title="Tokens since session start">
            <span className="statusbar-mono">{tokensText}</span>
            {costText ? <span className="statusbar-mono"> · {costText}</span> : null}
          </span>
        ) : null}
        {activeWorkspace ? (
          <button
            type="button"
            className="statusbar-workspace"
            onClick={handleWorkspaceClick}
            title={`${activeWorkspace} — click to reveal in OS`}
            style={{
              background: 'transparent',
              border: 0,
              padding: 0,
              font: 'inherit',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <span className="statusbar-workspace-icon" aria-hidden="true">
              ⌂
            </span>
            {workspaceBasename(activeWorkspace)}
          </button>
        ) : (
          <span className="statusbar-workspace" title="No workspace (using launch directory)">
            <span className="statusbar-workspace-icon" aria-hidden="true">
              ⌂
            </span>
            (no workspace)
          </span>
        )}
      </div>
    </footer>
  );
}

function stateLabel(state: StatusState): string {
  switch (state) {
    case 'streaming':
      return 'Streaming…';
    case 'error':
      return 'Error';
    case 'idle':
      return 'Idle';
  }
}
