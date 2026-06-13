import type { ChatEvent, ModelPricing, StopReason } from '@opencodex/core';
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
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}

export interface StreamChunksOptions {
  /** Looked up in the OpenAI model catalog for pricing. */
  model?: string;
  /**
   * Explicit pricing for cost computation — takes precedence over `model`.
   * Lets OpenAI-compatible providers (xAI, OpenRouter) reuse this translator
   * with their own catalogs.
   */
  pricing?: ModelPricing;
}

export async function* streamChunksToEvents(
  chunks: AsyncIterable<ChatChunk>,
  opts: StreamChunksOptions = {},
): AsyncGenerator<ChatEvent, void, void> {
  const pending = new Map<string, PendingToolCall>();
  let finishReason: string | null | undefined;
  let nextOrder = 0;
  const pricing = opts.pricing ?? (opts.model ? findModel(opts.model)?.pricing : undefined);

  for await (const chunk of chunks) {
    if (chunk.usage) {
      const u = chunk.usage;
      const cached = u.prompt_tokens_details?.cached_tokens;
      const cost = computeCostUsd({
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
        ...(pricing ? { pricing } : {}),
      });
      yield {
        type: 'usage',
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
        ...(cost !== undefined ? { costUsd: cost } : {}),
      };
    }

    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      yield { type: 'text_delta', delta: delta.content };
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const key =
          tc.index !== undefined
            ? `idx:${String(tc.index)}`
            : tc.id !== undefined
              ? `id:${tc.id}`
              : undefined;
        if (key === undefined) continue;
        const cur = pending.get(key) ?? { id: '', name: '', arguments: '', order: nextOrder++ };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        pending.set(key, cur);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
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
