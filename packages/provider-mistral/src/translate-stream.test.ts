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

describe('streamChunksToEvents stop-reason mapping', () => {
  it('maps finish_reason content_filter to a content_filter stop', async () => {
    const chunks: ChatChunk[] = [
      { choices: [{ index: 0, delta: { content: 'par' }, finish_reason: 'content_filter' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'content_filter' });
  });

  it('surfaces finish_reason error as an error event and done(error)', async () => {
    const chunks: ChatChunk[] = [
      { choices: [{ index: 0, delta: { content: 'par' }, finish_reason: 'error' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events).toContainEqual({ type: 'text_delta', delta: 'par' });
    expect(events.at(-2)).toMatchObject({ type: 'error', retryable: false, code: 'unknown' });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('skips partially accumulated tool calls when the stream errors', async () => {
    const chunks: ChatChunk[] = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  type: 'function',
                  function: { name: 'grep', arguments: '{' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'error' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('still maps model_length to max_tokens', async () => {
    const chunks: ChatChunk[] = [
      { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'model_length' }] },
    ];
    const events = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });
});
