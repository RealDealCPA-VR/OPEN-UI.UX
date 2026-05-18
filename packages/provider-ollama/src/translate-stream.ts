import type { ChatEvent, StopReason } from '@opencodex/core';
import type { ChatChunk } from './response-schemas';

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

export async function* streamChunksToEvents(
  chunks: AsyncIterable<ChatChunk>,
): AsyncGenerator<ChatEvent, void, void> {
  let toolCounter = 0;
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
        toolCounter += 1;
        sawToolCall = true;
        yield {
          type: 'tool_call',
          id: `call_${toolCounter}_${name}`,
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
    yield {
      type: 'usage',
      inputTokens: promptTokens ?? 0,
      outputTokens: completionTokens ?? 0,
    };
  }

  yield { type: 'done', stopReason: mapStopReason(doneReason, sawToolCall) };
}
