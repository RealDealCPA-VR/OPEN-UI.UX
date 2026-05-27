import { describe, expect, it, vi } from 'vitest';
import {
  NdjsonBuffer,
  createTranslatorState,
  fallbackTextDelta,
  translateOpenCodeJson,
} from './event-translator';

describe('translateOpenCodeJson', () => {
  it('emits text_delta for text events', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson({ type: 'text', text: 'Hello, world.' }, state);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello, world.' }]);
  });

  it('emits tool_call for tool events with input arguments', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson(
      {
        type: 'tool',
        id: 'tool_1',
        name: 'read_file',
        input: { path: '/etc/hosts' },
      },
      state,
    );
    expect(events).toEqual([
      {
        type: 'tool_call',
        id: 'tool_1',
        name: 'read_file',
        arguments: { path: '/etc/hosts' },
      },
    ]);
  });

  it('defaults tool arguments to {} when input is missing', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson({ type: 'tool', id: 'tool_2', name: 'noop' }, state);
    expect(events).toEqual([{ type: 'tool_call', id: 'tool_2', name: 'noop', arguments: {} }]);
  });

  it('emits tool_result for tool_result events', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson(
      {
        type: 'tool_result',
        id: 'tool_1',
        output: 'file contents',
        is_error: false,
      },
      state,
    );
    expect(events).toEqual([
      {
        type: 'tool_result',
        id: 'tool_1',
        output: 'file contents',
        isError: false,
      },
    ]);
  });

  it('emits usage + done for done events', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson(
      {
        type: 'done',
        is_error: false,
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.0015,
      },
      state,
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.0015,
    });
    expect(events[1]).toEqual({ type: 'done', stopReason: 'end_turn' });
    expect(state.resultEmitted).toBe(true);
    expect(state.usageEmitted).toBe(true);
  });

  it('emits done with error stopReason when done.is_error is true', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson(
      { type: 'done', is_error: true, usage: { input_tokens: 0, output_tokens: 0 } },
      state,
    );
    expect(events[1]).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('emits zero usage when done has no usage block', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson({ type: 'done' }, state);
    expect(events[0]).toEqual({ type: 'usage', inputTokens: 0, outputTokens: 0 });
  });

  it('emits error event for error stream entries', () => {
    const state = createTranslatorState();
    const events = translateOpenCodeJson(
      { type: 'error', message: 'rate limited', retryable: true },
      state,
    );
    expect(events).toEqual([{ type: 'error', message: 'rate limited', retryable: true }]);
  });

  it('returns empty array for unknown event types', () => {
    const state = createTranslatorState();
    const warn = vi.fn();
    const events = translateOpenCodeJson({ type: 'totally_made_up' }, state, { warn });
    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns empty array for system/status events without warning', () => {
    const state = createTranslatorState();
    const warn = vi.fn();
    expect(translateOpenCodeJson({ type: 'system' }, state, { warn })).toEqual([]);
    expect(translateOpenCodeJson({ type: 'status' }, state, { warn })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('fallbackTextDelta', () => {
  it('wraps a non-JSON line as a text_delta with trailing newline', () => {
    expect(fallbackTextDelta('hello')).toEqual({
      type: 'text_delta',
      delta: 'hello\n',
    });
  });

  it('strips trailing CR', () => {
    expect(fallbackTextDelta('hello\r')).toEqual({
      type: 'text_delta',
      delta: 'hello\n',
    });
  });

  it('returns null for empty lines', () => {
    expect(fallbackTextDelta('')).toBeNull();
    expect(fallbackTextDelta('\r')).toBeNull();
  });
});

describe('NdjsonBuffer', () => {
  it('splits multi-line chunks into individual lines', () => {
    const buf = new NdjsonBuffer();
    expect(buf.push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('buffers partial lines until a newline arrives', () => {
    const buf = new NdjsonBuffer();
    expect(buf.push('hel')).toEqual([]);
    expect(buf.push('lo\nwor')).toEqual(['hello']);
    expect(buf.push('ld\n')).toEqual(['world']);
  });

  it('strips trailing CR from CRLF-terminated lines', () => {
    const buf = new NdjsonBuffer();
    expect(buf.push('alpha\r\nbeta\r\n')).toEqual(['alpha', 'beta']);
  });

  it('flush returns any trailing partial line', () => {
    const buf = new NdjsonBuffer();
    buf.push('partial');
    expect(buf.flush()).toEqual(['partial']);
    expect(buf.flush()).toEqual([]);
  });

  it('skips empty lines between events', () => {
    const buf = new NdjsonBuffer();
    expect(buf.push('a\n\nb\n')).toEqual(['a', 'b']);
  });
});
