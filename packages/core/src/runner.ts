import type { ChatEvent } from './events';

export interface SubagentBudget {
  maxTokens?: number;
  maxToolIterations?: number;
  maxWallTimeMs?: number;
}

export interface SubagentRunOptions {
  task: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  providerId?: string;
  modelId?: string;
  allowedToolNames?: readonly string[];
  budget?: SubagentBudget;
  systemPrompt?: string;
}

export interface SubagentToolEvent {
  name: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number;
}

export type SubagentStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'budget_exceeded'
  | 'cancelled'
  | 'error'
  | 'unauthorized_tool'
  | 'runner_error'
  | 'runner_not_installed';

export interface SubagentResult {
  text: string;
  toolEvents: SubagentToolEvent[];
  inputTokens: number;
  outputTokens: number;
  stopReason: SubagentStopReason;
  error?: string;
  iterations: number;
}

export interface SubagentRunnerInstallCheck {
  ok: boolean;
  version?: string;
  hint?: string;
}

export interface SubagentRunner {
  readonly id: string;
  readonly displayName: string;
  readonly streaming: boolean;

  /**
   * Drive the subagent and emit a normalized ChatEvent stream.
   *
   * Contract:
   * - MUST emit at least one `done` event (terminal). Consumers rely on it to
   *   determine the final stop reason.
   * - SHOULD emit a `usage` event before `done` so token accounting is
   *   accurate; runners without token visibility may omit it.
   * - Runners are responsible for honoring `opts.budget` and SHOULD emit a
   *   terminal `done` with `stopReason: 'budget_exceeded'` (mapped from the
   *   chat-event vocabulary by the runner) when any limit
   *   (`maxTokens`, `maxToolIterations`, `maxWallTimeMs`) is hit. Cooperative
   *   AbortSignal cancellation is the caller's responsibility — runners SHOULD
   *   pass `opts.signal` to their transport and exit promptly.
   *
   * The legacy `SubagentResult` shape (text, toolEvents, tokens, stopReason,
   * iterations) is reconstructed from this stream by `collectSubagentResult`,
   * so adapters can stay stream-only.
   */
  run(opts: SubagentRunOptions): AsyncIterable<ChatEvent>;

  checkInstalled?(): Promise<SubagentRunnerInstallCheck>;
}

interface PendingToolCall {
  name: string;
  input: unknown;
  startedAt: number;
}

export async function collectSubagentResult(
  iter: AsyncIterable<ChatEvent>,
  signal?: AbortSignal,
): Promise<SubagentResult> {
  let text = '';
  const toolEvents: SubagentToolEvent[] = [];
  const pending = new Map<string, PendingToolCall>();
  let inputTokens = 0;
  let outputTokens = 0;
  let iterations = 0;
  let stopReason: SubagentStopReason = 'end_turn';
  let error: string | undefined;
  let aborted = false;

  const flushPending = (): void => {
    for (const [id, call] of pending) {
      toolEvents.push({
        name: call.name,
        input: call.input,
        output: undefined,
        isError: true,
        durationMs: Date.now() - call.startedAt,
      });
      pending.delete(id);
    }
  };

  try {
    for await (const evt of iter) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      switch (evt.type) {
        case 'text_delta':
          text += evt.delta;
          break;
        case 'tool_call': {
          iterations += 1;
          pending.set(evt.id, {
            name: evt.name,
            input: evt.arguments,
            startedAt: Date.now(),
          });
          break;
        }
        case 'tool_result': {
          const call = pending.get(evt.id);
          if (call) {
            pending.delete(evt.id);
            toolEvents.push({
              name: call.name,
              input: call.input,
              output: evt.output,
              isError: evt.isError ?? false,
              durationMs: Date.now() - call.startedAt,
            });
          } else {
            toolEvents.push({
              name: `<orphan:${evt.id}>`,
              input: undefined,
              output: evt.output,
              isError: true,
              durationMs: 0,
            });
          }
          break;
        }
        case 'usage':
          inputTokens += evt.inputTokens;
          outputTokens += evt.outputTokens;
          break;
        case 'done': {
          const r = evt.stopReason;
          if (r === 'cancelled') {
            stopReason = 'cancelled';
          } else if (r === 'budget_exceeded') {
            stopReason = 'budget_exceeded';
          } else if (error === undefined && stopReason !== 'error') {
            if (r === 'tool_use') stopReason = 'tool_use';
            else if (r === 'max_tokens') stopReason = 'max_tokens';
            else if (r === 'error') stopReason = 'error';
            else stopReason = 'end_turn';
          }
          break;
        }
        case 'error':
          stopReason = 'error';
          error = evt.message;
          break;
        default:
          break;
      }
    }
  } catch (cause) {
    stopReason = 'runner_error';
    error = String(cause);
    flushPending();
    return {
      text,
      toolEvents,
      inputTokens,
      outputTokens,
      stopReason,
      ...(error !== undefined ? { error } : {}),
      iterations,
    };
  }

  if (aborted) {
    if (stopReason !== 'cancelled') {
      stopReason = 'cancelled';
      const reason = signal?.reason;
      error = reason !== undefined ? String(reason) : 'aborted';
    }
  }

  return {
    text,
    toolEvents,
    inputTokens,
    outputTokens,
    stopReason,
    ...(error !== undefined ? { error } : {}),
    iterations,
  };
}
