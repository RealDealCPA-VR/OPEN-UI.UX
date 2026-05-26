export type AgentRunStatus = 'running' | 'completed' | 'failed';

export type AgentRunStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'budget_exceeded'
  | 'error'
  | 'unauthorized_tool';

export type AgentRunTriggerSource = 'user' | 'scheduled';

export interface AgentRunToolEvent {
  name: string;
  isError: boolean;
  durationMs: number;
}

export interface AgentRun {
  id: string;
  task: string;
  providerId: string;
  modelId: string;
  status: AgentRunStatus;
  startedAt: number;
  completedAt: number | null;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  toolEvents: AgentRunToolEvent[];
  stopReason: AgentRunStopReason | null;
  error: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  worktreeRepoRoot: string | null;
  mergeStatus: 'pending' | 'merged' | 'rejected' | null;
  triggerSource: AgentRunTriggerSource;
  scheduledTaskId: string | null;
}

export interface AgentRunsChangedEvent {
  runs: AgentRun[];
}
