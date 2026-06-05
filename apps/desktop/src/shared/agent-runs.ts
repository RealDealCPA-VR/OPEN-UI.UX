export type AgentRunStatus = 'running' | 'completed' | 'failed';

export type AgentRunStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'budget_exceeded'
  | 'cancelled'
  | 'error'
  | 'unauthorized_tool'
  | 'runner_error'
  | 'runner_not_installed';

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
  runnerId: string;
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
  seen: boolean;
  scheduledTaskId: string | null;
  budget?: number;
}

export interface AgentRunsChangedEvent {
  runs: AgentRun[];
}
