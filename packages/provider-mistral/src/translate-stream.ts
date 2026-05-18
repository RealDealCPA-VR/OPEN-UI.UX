import type { ChatEvent, StopReason } from '@opencodex/core';
import type { ChatChunk } from './response-schemas';

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
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

export async function* streamChunksToEvents(
  chunks: AsyncIterable<ChatChunk>,
): AsyncGenerator<ChatEvent, void, void> {
  const pending = new Map<number, PendingToolCall>();
  let finishReason: string | null | undefined;

  for await (const chunk of chunks) {
    if (chunk.usage) {
      yield {
        type: 'usage',
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
      };
    }

    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      yield { type: 'text_delta', delta: delta.content };
    }
    if (delta?.tool_calls) {
      for (const [pos, tc] of delta.tool_calls.entries()) {
        const idx = tc.index ?? pos;
        const cur = pending.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        pending.set(idx, cur);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const sorted = [...pending.entries()].sort(([a], [b]) => a - b);
  for (const [, call] of sorted) {
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
