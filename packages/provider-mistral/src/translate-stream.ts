import type { ChatEvent, StopReason } from '@opencodex/core';
import { computeCostUsd } from '@opencodex/core';
import type { ChatChunk } from './response-schemas';
import { findModel } from './models';

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
  order: number;
}

function mapStopReason(finish: string | null | undefined): StopReason {
  switch (finish) {
    case 'stop':
      return 'end_turn';
    case 'length':
    case 'model_length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

export interface StreamChunksOptions {
  model?: string;
}

export async function* streamChunksToEvents(
  chunks: AsyncIterable<ChatChunk>,
  opts: StreamChunksOptions = {},
): AsyncGenerator<ChatEvent, void, void> {
  const pending = new Map<string, PendingToolCall>();
  let nextOrder = 0;
  let finishReason: string | null | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  const pricing = opts.model ? findModel(opts.model)?.pricing : undefined;

  for await (const chunk of chunks) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
      if (cached !== undefined) cachedInputTokens = cached;
    }

    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      yield { type: 'text_delta', delta: delta.content };
    }
    if (delta?.tool_calls) {
      for (const [pos, tc] of delta.tool_calls.entries()) {
        const key =
          tc.index !== undefined
            ? `idx:${String(tc.index)}`
            : tc.id !== undefined
              ? `id:${tc.id}`
              : `pos:${String(pos)}`;
        const cur = pending.get(key) ?? { id: '', name: '', arguments: '', order: nextOrder++ };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        pending.set(key, cur);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  if (inputTokens !== undefined || outputTokens !== undefined) {
    const cost = computeCostUsd({
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(pricing ? { pricing } : {}),
    });
    yield {
      type: 'usage',
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  }

  const sorted = [...pending.values()].sort((a, b) => a.order - b.order);
  for (const call of sorted) {
    let args: unknown = {};
    if (call.arguments) {
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = call.arguments;
      }
    }
    yield { type: 'tool_call', id: call.id, name: call.name, arguments: args };
  }

  yield { type: 'done', stopReason: mapStopReason(finishReason) };
}
