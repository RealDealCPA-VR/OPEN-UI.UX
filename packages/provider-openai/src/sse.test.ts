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
  it('splits events on blank lines', async () => {
    const stream = streamOf('data: foo\n\ndata: bar\n\ndata: [DONE]\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['foo', 'bar', '[DONE]']);
  });

  it('joins multi-line data fields with newlines', async () => {
    const stream = streamOf('data: one\ndata: two\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['one\ntwo']);
  });

  it('ignores non-data lines (event:, id:, :comment)', async () => {
    const stream = streamOf('event: ping\nid: 42\n: keepalive\ndata: hi\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['hi']);
  });

  it('handles CRLF line endings', async () => {
    const stream = streamOf('data: a\r\n\r\ndata: b\r\n\r\n');
    expect(await collect(sseEvents(stream))).toEqual(['a', 'b']);
  });

  it('handles events split across chunk boundaries', async () => {
    const stream = streamOf('data: hel', 'lo\n\ndata: world\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['hello', 'world']);
  });

  it('returns nothing when stream has no data lines', async () => {
    const stream = streamOf(': just a comment\n\n');
    expect(await collect(sseEvents(stream))).toEqual([]);
  });
});
