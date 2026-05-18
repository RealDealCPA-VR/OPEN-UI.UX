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
  it('extracts data lines from named-event blocks', async () => {
    const stream = streamOf(
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
    );
    expect(await collect(sseEvents(stream))).toEqual([
      '{"type":"message_start"}',
      '{"type":"ping"}',
    ]);
  });

  it('joins multi-line data fields with newlines', async () => {
    const stream = streamOf('data: one\ndata: two\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['one\ntwo']);
  });

  it('ignores event:, id:, and comment lines', async () => {
    const stream = streamOf('event: ping\nid: 42\n: keepalive\ndata: hi\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['hi']);
  });

  it('handles CRLF line endings', async () => {
    const stream = streamOf('event: x\r\ndata: a\r\n\r\ndata: b\r\n\r\n');
    expect(await collect(sseEvents(stream))).toEqual(['a', 'b']);
  });

  it('handles events split across chunk boundaries', async () => {
    const stream = streamOf('event: content_block_delta\ndata: {"par', 'tial":true}\n\n');
    expect(await collect(sseEvents(stream))).toEqual(['{"partial":true}']);
  });

  it('returns nothing when stream has no data lines', async () => {
    const stream = streamOf('event: ping\n\n');
    expect(await collect(sseEvents(stream))).toEqual([]);
  });
});
