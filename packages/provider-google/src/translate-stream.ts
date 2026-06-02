import type { ChatEvent, StopReason } from '@opencodex/core';
import { computeCostUsd } from '@opencodex/core';
import type { GoogleUsageMetadata, StreamChunk } from './response-schemas';
import { findModel } from './models';

const CONTENT_FILTER_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
]);

function mapStopReason(finish: string | undefined): StopReason {
  switch (finish) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter';
    case 'MALFORMED_FUNCTION_CALL':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

export interface StreamChunksOptions {
  model?: string;
}

export async function* streamChunksToEvents(
  chunks: AsyncIterable<StreamChunk>,
  opts: StreamChunksOptions = {},
): AsyncGenerator<ChatEvent, void, void> {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens: number | undefined;
  let usageSeen = false;
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  let toolCallCounter = 0;
  let sawFunctionCall = false;

  const captureUsage = (u: GoogleUsageMetadata | undefined): void => {
    if (!u) return;
    usageSeen = true;
    if (u.promptTokenCount !== undefined) inputTokens = u.promptTokenCount;
    if (u.candidatesTokenCount !== undefined) outputTokens = u.candidatesTokenCount;
    if (u.cachedContentTokenCount !== undefined) cachedInputTokens = u.cachedContentTokenCount;
  };

  for await (const chunk of chunks) {
    captureUsage(chunk.usageMetadata);

    if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;

    const candidates = chunk.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if ('text' in part) {
          if (part.text) yield { type: 'text_delta', delta: part.text };
        } else if ('functionCall' in part) {
          sawFunctionCall = true;
          const fc = part.functionCall;
          const id = fc.id ?? `call_${String(toolCallCounter)}_${fc.name}`;
          toolCallCounter += 1;
          yield {
            type: 'tool_call',
            id,
            name: fc.name,
            arguments: fc.args ?? {},
          };
        }
      }
      if (candidate.finishReason) finishReason = candidate.finishReason;
    }
  }

  if (usageSeen) {
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

  if (finishReason !== undefined && CONTENT_FILTER_REASONS.has(finishReason)) {
    yield {
      type: 'error',
      message: `Google blocked the response: ${finishReason}`,
      retryable: false,
      code: 'content_filter',
    };
    yield { type: 'done', stopReason: 'content_filter' };
    return;
  }

  if (blockReason !== undefined) {
    yield {
      type: 'error',
      message: `Google blocked the prompt: ${blockReason}`,
      retryable: false,
      code: 'content_filter',
    };
    yield { type: 'done', stopReason: 'content_filter' };
    return;
  }

  const stop: StopReason = sawFunctionCall ? 'tool_use' : mapStopReason(finishReason);
  yield { type: 'done', stopReason: stop };
}
