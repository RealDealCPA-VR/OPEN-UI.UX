import { describe, expect, it } from 'vitest';
import { streamEventsToChatEvents } from './translate-stream';
import type { StreamEvent } from './response-schemas';

async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const x of arr) yield x;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('streamEventsToChatEvents', () => {
  it('emits text deltas in order then usage and done', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 10, output_tokens: 1 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 4 },
      },
      { type: 'message_stop' },
    ];
    expect(await collect(streamEventsToChatEvents(fromArray(events)))).toEqual([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'usage', inputTokens: 10, outputTokens: 4 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('accumulates a tool call across input_json_delta chunks', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: { id: 'msg_2', role: 'assistant', usage: { input_tokens: 5, output_tokens: 1 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'grep' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"hi"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 8 },
      },
      { type: 'message_stop' },
    ];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out).toContainEqual({
      type: 'tool_call',
      id: 'toolu_1',
      name: 'grep',
      arguments: { q: 'hi' },
    });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('falls back to raw partial_json when JSON parsing fails', async () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_x', name: 'f' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'not-json' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out).toContainEqual({
      type: 'tool_call',
      id: 'toolu_x',
      name: 'f',
      arguments: 'not-json',
    });
  });

  it('includes cachedInputTokens from cache_read_input_tokens', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          role: 'assistant',
          usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 80 },
        },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 5,
      cachedInputTokens: 80,
    });
  });

  it('costs full-rate input on top of cache reads (input_tokens excludes cache)', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          role: 'assistant',
          usage: { input_tokens: 1_000_000, output_tokens: 1, cache_read_input_tokens: 1_000_000 },
        },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } },
    ];
    const out = await collect(
      streamEventsToChatEvents(fromArray(events), { model: 'claude-haiku-4-5-20251001' }),
    );
    const usage = out.find((e) => e.type === 'usage');
    // input_tokens (1M) is the full-rate portion; cache_read (1M) is the cached portion.
    // haiku pricing: input $1/m, cached $0.1/m => $1.00 + $0.10 = $1.10.
    // The old (buggy) behavior subtracted cache reads from input_tokens, yielding $0.10.
    expect(usage).toBeDefined();
    expect(usage).toMatchObject({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000 });
    if (usage?.type === 'usage') {
      expect(usage.costUsd).toBeCloseTo(1.1);
    }
  });

  it('maps stop_reason max_tokens', async () => {
    const events: StreamEvent[] = [{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('defaults stopReason to end_turn when not observed', async () => {
    const events: StreamEvent[] = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } },
    ];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('translates an error stream event into error then done', async () => {
    const events: StreamEvent[] = [
      {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      },
    ];
    const out = await collect(streamEventsToChatEvents(fromArray(events)));
    expect(out[0]).toMatchObject({ type: 'error', retryable: true });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });
});
