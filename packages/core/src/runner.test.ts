import { describe, expect, it } from 'vitest';
import { collectSubagentResult } from './runner';
import type { ChatEvent } from './events';

async function* fromArray(events: ChatEvent[]): AsyncIterable<ChatEvent> {
  for (const evt of events) {
    yield evt;
  }
}

async function* throwingIterable(events: ChatEvent[], cause: unknown): AsyncIterable<ChatEvent> {
  for (const evt of events) {
    yield evt;
  }
  throw cause;
}

describe('collectSubagentResult', () => {
  it('returns end_turn for a clean stream', async () => {
    const result = await collectSubagentResult(
      fromArray([
        { type: 'text_delta', delta: 'hello' },
        { type: 'done', stopReason: 'end_turn' },
      ]),
    );
    expect(result.text).toBe('hello');
    expect(result.stopReason).toBe('end_turn');
    expect(result.error).toBeUndefined();
  });

  it('flags cancelled (not budget_exceeded) when signal aborts mid-stream', async () => {
    const controller = new AbortController();
    async function* slow(): AsyncIterable<ChatEvent> {
      yield { type: 'text_delta', delta: 'a' };
      controller.abort('user pressed stop');
      yield { type: 'text_delta', delta: 'b' };
      yield { type: 'done', stopReason: 'end_turn' };
    }
    const result = await collectSubagentResult(slow(), controller.signal);
    expect(result.stopReason).toBe('cancelled');
    expect(result.error).toBe('user pressed stop');
  });

  it("does not let a late 'done' clobber an existing error stopReason", async () => {
    const result = await collectSubagentResult(
      fromArray([
        { type: 'error', message: 'boom', retryable: false },
        { type: 'done', stopReason: 'end_turn' },
      ]),
    );
    expect(result.stopReason).toBe('error');
    expect(result.error).toBe('boom');
  });

  it('captures cancelled stop reason from chat events', async () => {
    const result = await collectSubagentResult(
      fromArray([{ type: 'done', stopReason: 'cancelled' }]),
    );
    expect(result.stopReason).toBe('cancelled');
  });

  it('catches iterator throws as runner_error and flushes pending tool calls', async () => {
    const result = await collectSubagentResult(
      throwingIterable(
        [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'read_file',
            arguments: { path: 'a.ts' },
          },
        ],
        new Error('transport crashed'),
      ),
    );
    expect(result.stopReason).toBe('runner_error');
    expect(result.error).toContain('transport crashed');
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]?.name).toBe('read_file');
    expect(result.toolEvents[0]?.isError).toBe(true);
  });

  it('flushes unresolved tool calls as errored events when the stream ends without a tool_result', async () => {
    const result = await collectSubagentResult(
      fromArray([
        { type: 'tool_call', id: 'call_1', name: 'write_file', arguments: { path: 'b.ts' } },
        { type: 'done', stopReason: 'cancelled' },
      ]),
    );
    expect(result.stopReason).toBe('cancelled');
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]?.name).toBe('write_file');
    expect(result.toolEvents[0]?.isError).toBe(true);
    expect(result.toolEvents[0]?.output).toBeUndefined();
  });

  it('flushes unresolved tool calls when the abort break exits the loop', async () => {
    const controller = new AbortController();
    async function* stream(): AsyncIterable<ChatEvent> {
      yield { type: 'tool_call', id: 'call_1', name: 'read_file', arguments: { path: 'a.ts' } };
      controller.abort('stop');
      yield { type: 'text_delta', delta: 'never collected' };
    }
    const result = await collectSubagentResult(stream(), controller.signal);
    expect(result.stopReason).toBe('cancelled');
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]?.name).toBe('read_file');
    expect(result.toolEvents[0]?.isError).toBe(true);
  });

  it('does not emit name="" for orphan tool_result events', async () => {
    const result = await collectSubagentResult(
      fromArray([
        { type: 'tool_result', id: 'unmatched', output: 'late', isError: false },
        { type: 'done', stopReason: 'end_turn' },
      ]),
    );
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]?.name).toBe('<orphan:unmatched>');
    expect(result.toolEvents[0]?.isError).toBe(true);
  });
});
