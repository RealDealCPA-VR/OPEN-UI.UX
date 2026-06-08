import { useEffect, useState } from 'react';
import { useChat } from '../state/chat-context';
import { useSelectedModel } from '../state/selected-model-context';
import { useCollapseState } from '../state/use-collapse-state';
import { BudgetSpendIndicator } from './BudgetSpendIndicator';
import {
  computeTokenMeterSegments,
  findRunningToolName,
  formatCacheSavings,
  formatCostUsd,
  formatTokens,
  workspaceBasename,
} from './status-bar-derive';

type StatusState = 'idle' | 'streaming' | 'error';

export function StatusBar(): JSX.Element {
  const { streaming, draft, usage, error } = useChat();
  const { selectedCapabilities } = useSelectedModel();
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  // Demoted by default — quiet developer instrumentation that reveals full
  // detail on hover; the chevron pins it expanded.
  const [compact, toggleCompact] = useCollapseState('statusbar-compact', true);

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

  const cacheText = (() => {
    if (draft && draft.cachedInputTokens !== null) {
      return formatCacheSavings(draft.cachedInputTokens, draft.inputTokens);
    }
    if (usage && usage.messageCount > 0) {
      return formatCacheSavings(usage.totalCachedInputTokens, usage.totalInputTokens);
    }
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
    <footer
      className={`statusbar statusbar-${state}${compact ? ' compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="statusbar-left">
        <button
          type="button"
          className="statusbar-toggle"
          onClick={toggleCompact}
          aria-label={compact ? 'Expand status details' : 'Collapse status details'}
          aria-pressed={!compact}
          title={compact ? 'Expand status details' : 'Collapse status details'}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <path
              d="M4 10l4-4 4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className={`statusbar-dot statusbar-dot-${state}`} aria-hidden="true" />
        <span className="statusbar-state">{stateLabel(state)}</span>
        {runningTool ? (
          <span className="statusbar-tool" title={`Running tool: ${runningTool}`}>
            <span className="statusbar-sep" aria-hidden="true">
              ›
            </span>
            <code
              className={
                streaming
                  ? 'statusbar-tool-name statusbar-tool-name-streaming'
                  : 'statusbar-tool-name'
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
          >
            <span aria-hidden="true" className="statusbar-token-meter">
              <span
                className={`statusbar-token-meter-fill${meter.ratio >= 0.9 ? ' danger' : meter.ratio >= 0.7 ? ' warn' : ''}`}
                style={{ width: `${Math.min(100, meter.ratio * 100)}%` }}
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
        {cacheText ? (
          <span
            className="statusbar-cache"
            title="Prompt-cache hit (cached input tokens · share of input)"
          >
            <span className="statusbar-mono">{cacheText}</span>
          </span>
        ) : null}
        <BudgetSpendIndicator />
        {activeWorkspace ? (
          <button
            type="button"
            className="statusbar-workspace"
            onClick={handleWorkspaceClick}
            title={`${activeWorkspace} — click to reveal in OS`}
          >
            <span className="statusbar-workspace-icon" aria-hidden="true" />
            {workspaceBasename(activeWorkspace)}
          </button>
        ) : (
          <span className="statusbar-workspace" title="No workspace (using launch directory)">
            <span className="statusbar-workspace-icon" aria-hidden="true" />
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
