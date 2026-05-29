import type {
  ChatEvent,
  ContentBlock,
  LLMProvider,
  Message,
  SubagentRunner,
  SubagentRunOptions as CoreSubagentRunOptions,
  Tool,
  ToolRegistry,
} from '@opencodex/core';
import { logger } from '../logger';
import { waitWhilePaused } from './pause-resume';

export interface SubagentBudget {
  maxTokens?: number;
  maxToolIterations?: number;
  maxWallTimeMs?: number;
}

export interface SubagentRunOptions {
  task: string;
  provider: LLMProvider;
  modelId: string;
  toolRegistry: ToolRegistry;
  allowedToolNames?: readonly string[];
  workspaceRoot: string;
  budget?: SubagentBudget;
  signal?: AbortSignal;
  systemPrompt?: string;
  runId?: string;
}

export interface SubagentToolEvent {
  name: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number;
}

export interface SubagentResult {
  text: string;
  toolEvents: SubagentToolEvent[];
  inputTokens: number;
  outputTokens: number;
  stopReason:
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'budget_exceeded'
    | 'error'
    | 'unauthorized_tool'
    | 'runner_error'
    | 'runner_not_installed';
  error?: string;
  iterations: number;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_SYSTEM_PROMPT = [
  'You are an OpenCodex subagent. You have been spawned by an orchestrator agent with a focused task.',
  'Stay narrowly on-task. Do not ask follow-up questions; act on the task as written.',
  'When the task is complete, summarize what you did in 1-3 sentences. Do not chain further work.',
].join('\n');

export async function runSubagent(opts: SubagentRunOptions): Promise<SubagentResult> {
  const maxIterations = opts.budget?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const maxTokens = opts.budget?.maxTokens;
  const wallStart = Date.now();
  const wallBudget = opts.budget?.maxWallTimeMs;
  const toolEvents: SubagentToolEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const tools: Tool[] = [];
  for (const t of opts.toolRegistry['tools' as keyof ToolRegistry] instanceof Map
    ? Array.from((opts.toolRegistry as unknown as { tools: Map<string, Tool> }).tools.values())
    : []) {
    if (!opts.allowedToolNames || opts.allowedToolNames.includes(t.name)) tools.push(t);
  }

  const messages: Message[] = [
    { role: 'system', content: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    { role: 'user', content: opts.task },
  ];

  let stopReason: SubagentResult['stopReason'] = 'end_turn';
  let lastAssistantText = '';
  let iter = 0;

  for (iter = 0; iter < maxIterations; iter++) {
    if (opts.runId) {
      await waitWhilePaused(opts.runId, opts.signal);
    }
    if (opts.signal?.aborted) {
      return finalize('error', 'aborted');
    }
    if (wallBudget && Date.now() - wallStart > wallBudget) {
      return finalize('budget_exceeded', `wall time > ${wallBudget}ms`);
    }
    if (maxTokens && inputTokens + outputTokens > maxTokens) {
      return finalize('budget_exceeded', `token budget > ${maxTokens}`);
    }

    const stream = opts.provider.chat({
      model: opts.modelId,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        permissionTier: t.permissionTier,
      })),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    const assistantBlocks: ContentBlock[] = [];
    let textBuffer = '';
    const pendingToolCalls: { id: string; name: string; arguments: unknown }[] = [];
    let turnStop: SubagentResult['stopReason'] = 'end_turn';

    for await (const evt of stream as AsyncIterable<ChatEvent>) {
      switch (evt.type) {
        case 'text_delta':
          textBuffer += evt.delta;
          break;
        case 'tool_call':
          pendingToolCalls.push({ id: evt.id, name: evt.name, arguments: evt.arguments });
          break;
        case 'usage':
          inputTokens += evt.inputTokens;
          outputTokens += evt.outputTokens;
          break;
        case 'done':
          if (evt.stopReason === 'tool_use') turnStop = 'tool_use';
          else if (evt.stopReason === 'max_tokens') turnStop = 'max_tokens';
          else turnStop = 'end_turn';
          break;
        case 'error':
          return finalize('error', evt.message);
        default:
          break;
      }
    }

    if (textBuffer) {
      assistantBlocks.push({ type: 'text', text: textBuffer });
      lastAssistantText = textBuffer;
    }
    for (const call of pendingToolCalls) {
      assistantBlocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    if (pendingToolCalls.length === 0) {
      stopReason = turnStop;
      break;
    }

    if (opts.allowedToolNames) {
      const allowed = new Set(opts.allowedToolNames);
      for (const call of pendingToolCalls) {
        if (!allowed.has(call.name)) {
          toolEvents.push({
            name: call.name,
            input: call.arguments,
            output: { error: `tool not in allowedToolNames whitelist: ${call.name}` },
            isError: true,
            durationMs: 0,
          });
          return finalize(
            'unauthorized_tool',
            `tool not in allowedToolNames whitelist: ${call.name}`,
          );
        }
      }
    }

    const toolResults: ContentBlock[] = [];
    for (const call of pendingToolCalls) {
      const start = Date.now();
      let output: unknown;
      let isError = false;
      try {
        output = await opts.toolRegistry.execute(call.name, call.arguments, {
          workspaceRoot: opts.workspaceRoot,
          signal: opts.signal ?? new AbortController().signal,
          logger: {
            info: (msg, meta) => logger.info({ pluginScope: 'subagent', meta }, msg),
            error: (msg, meta) => logger.error({ pluginScope: 'subagent', meta }, msg),
          },
        });
      } catch (err) {
        isError = true;
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      const durationMs = Date.now() - start;
      toolEvents.push({ name: call.name, input: call.arguments, output, isError, durationMs });
      toolResults.push({
        type: 'tool_result',
        toolUseId: call.id,
        output,
        ...(isError ? { isError: true } : {}),
      });
    }
    messages.push({ role: 'tool', content: toolResults });
  }

  if (iter >= maxIterations && stopReason === 'end_turn') {
    stopReason = 'budget_exceeded';
  }

  return finalize(stopReason);

  function finalize(reason: SubagentResult['stopReason'], errorMsg?: string): SubagentResult {
    return {
      text: lastAssistantText,
      toolEvents,
      inputTokens,
      outputTokens,
      stopReason: reason,
      ...(errorMsg ? { error: errorMsg } : {}),
      iterations: iter,
    };
  }
}

// TODO(phase9+): true streaming requires refactoring runSubagent to expose its
// internal loop events. For now we synthesize ChatEvents from the final result.
function mapStopReasonToChatStop(
  r: SubagentResult['stopReason'],
): 'end_turn' | 'tool_use' | 'max_tokens' | 'error' {
  if (r === 'tool_use') return 'tool_use';
  if (r === 'max_tokens') return 'max_tokens';
  if (r === 'end_turn') return 'end_turn';
  return 'error';
}

async function* internalRunnerRun(opts: CoreSubagentRunOptions): AsyncGenerator<ChatEvent> {
  if (!opts.providerId || !opts.modelId) {
    yield {
      type: 'error',
      message: 'internalRunner requires providerId and modelId',
      retryable: false,
    };
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  let provider: LLMProvider;
  let toolRegistry: ToolRegistry;
  try {
    const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
      import('../chat/provider-builder'),
      import('../tools/registry'),
    ]);
    provider = await buildProviderForId(opts.providerId);
    toolRegistry = getToolRegistry();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message, retryable: false };
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  if (opts.signal?.aborted) {
    yield { type: 'error', message: 'aborted', retryable: false };
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  let result: SubagentResult;
  try {
    result = await runSubagent({
      task: opts.task,
      provider,
      modelId: opts.modelId,
      toolRegistry,
      ...(opts.allowedToolNames ? { allowedToolNames: opts.allowedToolNames } : {}),
      workspaceRoot: opts.workspaceRoot,
      ...(opts.budget ? { budget: opts.budget } : {}),
      ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message, retryable: false };
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  if (opts.signal?.aborted) {
    yield { type: 'error', message: 'aborted', retryable: false };
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  if (result.text) {
    yield { type: 'text_delta', delta: result.text };
  }

  for (let i = 0; i < result.toolEvents.length; i++) {
    const ev = result.toolEvents[i];
    if (!ev) continue;
    const id = `internal-${i}`;
    yield { type: 'tool_call', id, name: ev.name, arguments: ev.input };
    yield {
      type: 'tool_result',
      id,
      output: ev.output,
      ...(ev.isError ? { isError: true } : {}),
    };
  }

  yield {
    type: 'usage',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };

  if (result.error) {
    yield { type: 'error', message: result.error, retryable: false };
  }

  yield { type: 'done', stopReason: mapStopReasonToChatStop(result.stopReason) };
}

export const internalRunner: SubagentRunner = {
  id: 'internal',
  displayName: 'OpenCodex built-in',
  streaming: true,
  run(opts) {
    return internalRunnerRun(opts);
  },
};
