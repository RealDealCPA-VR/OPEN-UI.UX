import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceEntry } from '../../shared/workspaces';

interface MultiWorkspaceSelectorProps {
  /** The conversation whose workspace set is being edited. `null` shows a disabled state. */
  conversationId: string | null;
  /** When the bridge is unavailable (tests, sandbox), an injected list of all workspaces. */
  injectedAvailable?: WorkspaceEntry[];
  /** When the bridge is unavailable, an injected list of selected workspaces. */
  injectedSelected?: WorkspaceEntry[];
  /** Optional callback fired after a successful link/unlink so the parent can refresh state. */
  onChanged?: (selected: WorkspaceEntry[]) => void;
}

interface SelectorState {
  available: WorkspaceEntry[];
  selected: WorkspaceEntry[];
  loading: boolean;
  error: string | null;
}

const EMPTY: SelectorState = { available: [], selected: [], loading: false, error: null };

function workspaceLabel(ws: WorkspaceEntry): string {
  if (ws.displayName && ws.displayName.length > 0) return ws.displayName;
  const sep = ws.path.includes('/') ? '/' : '\\';
  const idx = ws.path.lastIndexOf(sep);
  return idx >= 0 ? ws.path.slice(idx + 1) : ws.path;
}

export function MultiWorkspaceSelector({
  conversationId,
  injectedAvailable,
  injectedSelected,
  onChanged,
}: MultiWorkspaceSelectorProps): JSX.Element {
  const bridge =
    typeof window !== 'undefined'
      ? (window as Window & { opencodex?: { workspaces?: WorkspacesBridge } }).opencodex?.workspaces
      : undefined;

  const [state, setState] = useState<SelectorState>(() => {
    if (injectedAvailable !== undefined || injectedSelected !== undefined) {
      return {
        available: injectedAvailable ?? [],
        selected: injectedSelected ?? [],
        loading: false,
        error: null,
      };
    }
    return EMPTY;
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    if (!conversationId) {
      setState((s) => ({ ...s, selected: [] }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [all, linked] = await Promise.all([
        bridge.list(),
        bridge.listForConversation(conversationId),
      ]);
      setState({
        available: all.workspaces,
        selected: linked.workspaces,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [bridge, conversationId]);

  useEffect(() => {
    if (!bridge) return;
    void refresh();
    const off = bridge.onChanged?.(() => {
      void refresh();
    });
    return off;
  }, [bridge, refresh]);

  const selectedIds = useMemo(() => new Set(state.selected.map((w) => w.id)), [state.selected]);

  const handleToggle = async (workspace: WorkspaceEntry): Promise<void> => {
    if (!conversationId) return;
    if (!bridge) return;
    const isSelected = selectedIds.has(workspace.id);
    try {
      const result = isSelected
        ? await bridge.unlinkFromConversation({
            conversationId,
            workspaceId: workspace.id,
          })
        : await bridge.linkToConversation({
            conversationId,
            workspaceId: workspace.id,
          });
      setState((s) => ({ ...s, selected: result.workspaces, error: null }));
      onChanged?.(result.workspaces);
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div className="multi-workspace-selector" data-testid="multi-workspace-selector">
      <div className="multi-workspace-selector-header">
        <span className="multi-workspace-selector-title">Workspaces</span>
        {state.loading ? <span className="multi-workspace-selector-loading">…</span> : null}
      </div>
      {state.error ? (
        <div className="multi-workspace-selector-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.available.length === 0 ? (
        <div className="multi-workspace-selector-empty">
          No workspaces configured. Add one from Settings.
        </div>
      ) : (
        <ul className="multi-workspace-selector-chips">
          {state.available.map((ws) => {
            const selected = selectedIds.has(ws.id);
            return (
              <li key={ws.id}>
                <button
                  type="button"
                  className={`multi-workspace-chip${selected ? ' is-selected' : ''}`}
                  data-selected={selected}
                  onClick={() => {
                    void handleToggle(ws);
                  }}
                  disabled={!conversationId || !bridge}
                  title={ws.path}
                  aria-pressed={selected}
                >
                  <span className="multi-workspace-chip-dot" aria-hidden="true" />
                  <span className="multi-workspace-chip-label">{workspaceLabel(ws)}</span>
                  {ws.isPrimary ? (
                    <span className="multi-workspace-chip-primary" aria-label="primary">
                      primary
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface WorkspacesBridge {
  list: () => Promise<{ workspaces: WorkspaceEntry[] }>;
  listForConversation: (id: string) => Promise<{ workspaces: WorkspaceEntry[] }>;
  linkToConversation: (req: {
    conversationId: string;
    workspaceId: string;
  }) => Promise<{ workspaces: WorkspaceEntry[] }>;
  unlinkFromConversation: (req: {
    conversationId: string;
    workspaceId: string;
  }) => Promise<{ workspaces: WorkspaceEntry[] }>;
  onChanged?: (listener: () => void) => () => void;
}
