import { useEffect, useState } from 'react';
import { useChat } from '../state/chat-context';
import {
  findRunningToolName,
  formatCostUsd,
  formatTokens,
  workspaceBasename,
} from './status-bar-derive';

type StatusState = 'idle' | 'streaming' | 'error';

export function StatusBar(): JSX.Element {
  const { streaming, draft, usage, error } = useChat();
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
            <code className="statusbar-tool-name">{runningTool}</code>
          </span>
        ) : null}
      </div>
      <div className="statusbar-right">
        {tokensText ? (
          <span className="statusbar-tokens">
            <span className="statusbar-mono">{tokensText}</span>
            {costText ? <span className="statusbar-mono"> · {costText}</span> : null}
          </span>
        ) : null}
        <span
          className="statusbar-workspace"
          title={activeWorkspace ?? 'No workspace (using launch directory)'}
        >
          <span className="statusbar-workspace-icon" aria-hidden="true">
            ⌂
          </span>
          {activeWorkspace ? workspaceBasename(activeWorkspace) : '(no workspace)'}
        </span>
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
