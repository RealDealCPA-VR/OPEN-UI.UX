import type { Trigger } from './triggers';

export type ScheduledTaskStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  trigger: Trigger;
  prompt: string;
  providerId: string;
  model: string;
  workspacePath: string;
  allowedTools: string[];
  useWorktree: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: ScheduledTaskStatus | null;
  lastRunId: string | null;
  linkedSkillId: string | null;
  runnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  startedAt: string;
  completedAt: string | null;
  status: ScheduledTaskStatus;
  agentRunId: string | null;
  errorMessage: string | null;
  wasCatchup: boolean;
}

export interface CreateScheduledTaskRequest {
  name: string;
  description?: string;
  trigger: Trigger;
  prompt: string;
  providerId: string;
  model: string;
  workspacePath: string;
  allowedTools?: string[];
  useWorktree?: boolean;
  enabled?: boolean;
  linkedSkillId?: string | null;
  runnerId?: string | null;
}

export interface UpdateScheduledTaskRequest {
  id: string;
  name?: string;
  description?: string;
  trigger?: Trigger;
  prompt?: string;
  providerId?: string;
  model?: string;
  workspacePath?: string;
  allowedTools?: string[];
  useWorktree?: boolean;
  enabled?: boolean;
  linkedSkillId?: string | null;
  runnerId?: string | null;
}

export interface DeleteScheduledTaskRequest {
  id: string;
}

export interface RunNowRequest {
  id: string;
}

export interface RunNowResponse {
  ok: boolean;
  runId?: string;
  agentRunId?: string;
  error?: string;
}

export interface ListRunsRequest {
  taskId: string;
  limit?: number;
  beforeId?: string | null;
}

export interface ListRunsResponse {
  runs: ScheduledTaskRun[];
  nextCursor: string | null;
}

export interface GetRunRequest {
  id: string;
}

export interface ScheduledTasksChangedEvent {
  tasks: ScheduledTask[];
}

export interface ScheduledRunCompletedEvent {
  taskId: string;
  runId: string;
  status: ScheduledTaskStatus;
  agentRunId: string | null;
}
