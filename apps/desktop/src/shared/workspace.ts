export interface WorkspaceState {
  active: string | null;
  history: string[];
}

export interface SetActiveWorkspaceRequest {
  path: string;
}

export interface RemoveWorkspaceRequest {
  path: string;
}

export interface WorkspaceChangedEvent {
  state: WorkspaceState;
}

export const WORKSPACE_HISTORY_LIMIT = 10;

export function applySetActive(state: WorkspaceState, path: string): WorkspaceState {
  const filtered = state.history.filter((p) => p !== path);
  const history = [path, ...filtered].slice(0, WORKSPACE_HISTORY_LIMIT);
  return { active: path, history };
}

export function applyRemove(state: WorkspaceState, path: string): WorkspaceState {
  const history = state.history.filter((p) => p !== path);
  const active = state.active === path ? null : state.active;
  return { active, history };
}
