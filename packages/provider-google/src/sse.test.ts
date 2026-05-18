import { describe, expect, it } from 'vitest';
import { sseEvents } from './sse';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('sseEvents', () => {
  it('extracts data lines from plain SSE events', async () => {
    const stream = streamOf('data: {"a":1}\n\n', 'data: {"b":2}\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data fields with newlines', async () => {
    const stream = streamOf('data: one\ndata: two\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['one\ntwo']);
  });

  it('handles CRLF line endings', async () => {
    const stream = streamOf('data: a\r\n\r\ndata: b\r\n\r\n');
    expect(await collect(sseEvents(stream))).toEqual(['a', 'b']);
  });

  it('handles events split across chunk boundaries', async () => {
    const stream = streamOf('data: {"par', 'tial":true}\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['{"partial":true}']);
  });

  it('returns nothing when stream has no data lines', async () => {
    const stream = streamOf(': keepalive\n\n');
    expect(await collect(sseEvents(stream))).toEqual([]);
  });
});
