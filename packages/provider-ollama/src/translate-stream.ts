import { randomUUID } from 'node:crypto';
import type { ChatEvent, StopReason } from '@opencodex/core';
import { computeCostUsd } from '@opencodex/core';
import type { ChatChunk } from './response-schemas';
import { findModel } from './models';

function mapStopReason(reason: string | undefined, sawToolCall: boolean): StopReason {
  if (sawToolCall) return 'tool_use';
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
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
  let sawToolCall = false;
  let doneReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  for await (const chunk of chunks) {
    const msg = chunk.message;
    if (msg?.content) {
      yield { type: 'text_delta', delta: msg.content };
    }
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        const name = tc.function.name;
        const raw = tc.function.arguments;
        let args: unknown = {};
        if (typeof raw === 'string') {
          try {
            args = JSON.parse(raw);
          } catch {
            args = raw;
          }
        } else {
          args = raw;
        }
        sawToolCall = true;
        yield {
          type: 'tool_call',
          id: `call_${randomUUID()}`,
          name,
          arguments: args,
        };
      }
    }
    if (chunk.done) {
      doneReason = chunk.done_reason;
      promptTokens = chunk.prompt_eval_count;
      completionTokens = chunk.eval_count;
    }
  }

  if (promptTokens !== undefined || completionTokens !== undefined) {
    const pricing = opts.model ? findModel(opts.model)?.pricing : undefined;
    const cost = computeCostUsd({
      inputTokens: promptTokens ?? 0,
      outputTokens: completionTokens ?? 0,
      ...(pricing ? { pricing } : {}),
    });
    yield {
      type: 'usage',
      inputTokens: promptTokens ?? 0,
      outputTokens: completionTokens ?? 0,
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  }

  yield { type: 'done', stopReason: mapStopReason(doneReason, sawToolCall) };
}
