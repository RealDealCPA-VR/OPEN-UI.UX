import type { ChatEvent, StopReason } from '@opencodex/core';
import { computeCostUsd } from '@opencodex/core';
import type { AnthropicStopReason, AnthropicUsage, StreamEvent } from './response-schemas';
import { findModel } from './models';

interface PendingToolUse {
  id: string;
  name: string;
  partialJson: string;
}

function mapStopReason(reason: AnthropicStopReason | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

export interface StreamEventsOptions {
  model?: string;
}

export async function* streamEventsToChatEvents(
  events: AsyncIterable<StreamEvent>,
  opts: StreamEventsOptions = {},
): AsyncGenerator<ChatEvent, void, void> {
  const toolBlocks = new Map<number, PendingToolUse>();
  let inputTokens = 0;
  let cachedInputTokens: number | undefined;
  let outputTokens = 0;
  let stopReason: AnthropicStopReason | null | undefined;

  const captureUsage = (u: AnthropicUsage | undefined): void => {
    if (!u) return;
    if (u.input_tokens !== undefined) inputTokens = u.input_tokens;
    if (u.cache_read_input_tokens !== undefined) cachedInputTokens = u.cache_read_input_tokens;
    if (u.output_tokens !== undefined) outputTokens = u.output_tokens;
  };

  for await (const evt of events) {
    switch (evt.type) {
      case 'message_start':
        captureUsage(evt.message.usage);
        break;
      case 'content_block_start':
        if (evt.content_block.type === 'tool_use') {
          toolBlocks.set(evt.index, {
            id: evt.content_block.id,
            name: evt.content_block.name,
            partialJson: '',
          });
        }
        break;
      case 'content_block_delta':
        if (evt.delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: evt.delta.text };
        } else {
          const cur = toolBlocks.get(evt.index);
          if (cur) cur.partialJson += evt.delta.partial_json;
        }
        break;
      case 'content_block_stop': {
        const cur = toolBlocks.get(evt.index);
        if (!cur) break;
        let args: unknown = {};
        if (cur.partialJson) {
          try {
            args = JSON.parse(cur.partialJson);
          } catch {
            args = cur.partialJson;
          }
        }
        yield { type: 'tool_call', id: cur.id, name: cur.name, arguments: args };
        toolBlocks.delete(evt.index);
        break;
      }
      case 'message_delta':
        captureUsage(evt.usage);
        if (evt.delta.stop_reason !== undefined) stopReason = evt.delta.stop_reason;
        break;
      case 'message_stop':
        break;
      case 'error':
        yield {
          type: 'error',
          message: `${evt.error.type}: ${evt.error.message}`,
          retryable: evt.error.type === 'overloaded_error' || evt.error.type === 'rate_limit_error',
        };
        yield { type: 'done', stopReason: 'error' };
        return;
      case 'ping':
        break;
    }
  }

  if (inputTokens > 0 || outputTokens > 0) {
    const pricing = opts.model ? findModel(opts.model)?.pricing : undefined;
    const cost = computeCostUsd({
      inputTokens,
      outputTokens,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(pricing ? { pricing } : {}),
    });
    yield {
      type: 'usage',
      inputTokens,
      outputTokens,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(cost !== undefined ? { costUsd: cost } : {}),
    };
  }
  yield { type: 'done', stopReason: mapStopReason(stopReason) };
}
