import { describe, expect, it } from 'vitest';
import { streamChunksToEvents } from './translate-stream';
import type { StreamChunk } from './response-schemas';

async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const x of arr) yield x;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('streamChunksToEvents', () => {
  it('emits text deltas in order then usage and done', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, index: 0 }],
      },
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: ' world' }] },
            index: 0,
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
      },
    ];
    expect(await collect(streamChunksToEvents(fromArray(chunks)))).toEqual([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'usage', inputTokens: 10, outputTokens: 4 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('emits a tool_call with the functionCall id when provided', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { id: 'call_xyz', name: 'grep', args: { q: 'hi' } } }],
            },
            index: 0,
            finishReason: 'STOP',
          },
        ],
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out).toContainEqual({
      type: 'tool_call',
      id: 'call_xyz',
      name: 'grep',
      arguments: { q: 'hi' },
    });
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('synthesizes a tool_call id when functionCall.id is missing', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'grep', args: { q: 'hi' } } }],
            },
          },
        ],
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out[0]).toEqual({
      type: 'tool_call',
      id: 'call_0_grep',
      name: 'grep',
      arguments: { q: 'hi' },
    });
  });

  it('treats a tool_use stop as tool_use regardless of finishReason', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'f', args: {} } }],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('maps MAX_TOKENS finish reason', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'x' }] }, finishReason: 'MAX_TOKENS' },
        ],
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
  });

  it('maps SAFETY finish reason to a content_filter error event then done', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [{ finishReason: 'SAFETY' }],
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out).toContainEqual(
      expect.objectContaining({
        type: 'error',
        code: 'content_filter',
        retryable: false,
      }),
    );
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'content_filter' });
  });

  it('maps a prompt-level blockReason to a content_filter error event then done', async () => {
    const chunks: StreamChunk[] = [
      {
        promptFeedback: { blockReason: 'SAFETY' },
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out).toContainEqual(
      expect.objectContaining({
        type: 'error',
        code: 'content_filter',
        retryable: false,
      }),
    );
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'content_filter' });
  });

  it('does not duplicate content_filter when a candidate finishReason already blocked', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [{ finishReason: 'SAFETY' }],
        promptFeedback: { blockReason: 'OTHER' },
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    const errors = out.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'content_filter' });
  });

  it('includes cachedInputTokens from cachedContentTokenCount', async () => {
    const chunks: StreamChunk[] = [
      {
        candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 1,
          cachedContentTokenCount: 80,
        },
      },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 1,
      cachedInputTokens: 80,
    });
  });

  it('defaults stopReason to end_turn when nothing observed', async () => {
    const chunks: StreamChunk[] = [
      { candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] },
    ];
    const out = await collect(streamChunksToEvents(fromArray(chunks)));
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });
});
