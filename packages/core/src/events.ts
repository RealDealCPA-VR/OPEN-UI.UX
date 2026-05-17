export interface TextDelta {
  type: 'text_delta';
  delta: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  id: string;
  output: unknown;
  isError?: boolean;
}

export interface UsageEvent {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface DoneEvent {
  type: 'done';
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  retryable: boolean;
  cause?: unknown;
}

export type ChatEvent =
  | TextDelta
  | ToolCallEvent
  | ToolResultEvent
  | UsageEvent
  | DoneEvent
  | ErrorEvent;
