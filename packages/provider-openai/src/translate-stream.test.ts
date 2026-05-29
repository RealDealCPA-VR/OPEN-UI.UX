import { describe, expect, it } from 'vitest';
import { streamChunksToEvents } from './translate-stream';
import type { ChatChunk } from './response-schemas';

async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const x of arr) yield x;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('streamChunksToEvents', () => {
  it('emits text deltas in order then done', async () => {
    const chunks: ChatChunk[] = [
      { choices: [{ index: 0, delta: { content: 'Hello' } }] },
      { choices: [{ index: 0, delta: { content: ' world' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    expect(await collect(streamChunksToEvents(fromArray(chunks)))).toEqual([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('accumulates a tool call across chunks and emits it before done', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'grep' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'grep',
      arguments: { q: 'hello' },
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('falls back to the raw arguments string when JSON parsing fails', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'c',
                  type: 'function',
                  function: { name: 'f', arguments: 'not-json' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'c',
      name: 'f',
      arguments: 'not-json',
    });
  });

  it('emits a usage event with cachedInputTokens when present', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
          prompt_tokens_details: { cached_tokens: 6 },
        },
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 6,
    });
  });

  it('maps finish_reason length to max_tokens', async () => {
    const chunks: ChatChunk[] = [
      { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'length' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('defaults to end_turn when no finish_reason is observed', async () => {
    const chunks: ChatChunk[] = [{ choices: [{ index: 0, delta: { content: 'x' } }] }];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('keys tool_call deltas by id when index is absent', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ id: 'call_A', type: 'function', function: { name: 'grep' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ id: 'call_A', function: { arguments: '{"q":"x"}' } }],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'call_A',
      name: 'grep',
      arguments: { q: 'x' },
    });
  });

  it('emits costUsd when a known model is supplied', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks), { model: 'gpt-4o' }));
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ type: 'usage', costUsd: expect.any(Number) });
  });
});
