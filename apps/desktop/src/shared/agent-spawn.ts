export interface AgentSpawnFromUiRequest {
  task: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
  useWorktree: boolean;
}

export interface AgentSpawnFromUiResponse {
  runId: string;
}

export interface AgentAbortRunRequest {
  runId: string;
}

export interface AgentAbortRunResponse {
  ok: boolean;
  error?: string;
}

export interface GitIsRepoRequest {
  path: string;
}

export interface GitIsRepoResponse {
  isRepo: boolean;
}

export interface ShellShowItemRequest {
  workspaceRoot: string;
  path: string;
}

export interface ShellShowItemResponse {
  ok: boolean;
  error?: string;
}
