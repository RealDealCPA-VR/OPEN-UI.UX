import { describe, expect, it, vi } from 'vitest';
import { NdjsonBuffer, createTranslatorState, translateClaudeJson } from './event-translator';

describe('translateClaudeJson', () => {
  it('emits text_delta for assistant text blocks', () => {
    const state = createTranslatorState();
    const events = translateClaudeJson(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello, world.' }],
        },
      },
      state,
    );
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello, world.' }]);
  });

  it('emits tool_call for assistant tool_use blocks with arguments', () => {
    const state = createTranslatorState();
    const events = translateClaudeJson(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'read_file',
              input: { path: '/etc/hosts' },
            },
          ],
        },
      },
      state,
    );
    expect(events).toEqual([
      {
        type: 'tool_call',
        id: 'toolu_1',
        name: 'read_file',
        arguments: { path: '/etc/hosts' },
      },
    ]);
  });

  it('emits tool_result for user tool_result blocks', () => {
    const state = createTranslatorState();
    const events = translateClaudeJson(
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'file contents',
              is_error: false,
            },
          ],
        },
      },
      state,
    );
    expect(events).toEqual([
      {
        type: 'tool_result',
        id: 'toolu_1',
        output: 'file contents',
        isError: false,
      },
    ]);
  });

  it('emits usage + done for result events', () => {
    const state = createTranslatorState();
    const events = translateClaudeJson(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: { input_tokens: 123, output_tokens: 45 },
        total_cost_usd: 0.0012,
      },
      state,
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'usage',
      inputTokens: 123,
      outputTokens: 45,
      costUsd: 0.0012,
    });
    expect(events[1]).toEqual({ type: 'done', stopReason: 'end_turn' });
    expect(state.resultEmitted).toBe(true);
    expect(state.usageEmitted).toBe(true);
  });

  it('emits done with error stopReason when result.is_error is true', () => {
    const state = createTranslatorState();
    const events = translateClaudeJson(
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      state,
    );
    expect(events[1]).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('returns empty array for unknown event types', () => {
    const state = createTranslatorState();
    const warn = vi.fn();
    const events = translateClaudeJson({ type: 'totally_made_up' }, state, { warn });
    expect(events).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns empty array for system events without warning', () => {
    const state = createTranslatorState();
    const warn = vi.fn();
    const events = translateClaudeJson({ type: 'system' }, state, { warn });
    expect(events).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('NdjsonBuffer', () => {
  it('splits multi-line chunks into individual lines', () => {
    const buf = new NdjsonBuffer();
    const lines = buf.push('a\nb\nc\n');
    expect(lines).toEqual(['a', 'b', 'c']);
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

  it('drops buffered bytes past the cap when no newline arrives (OOM guard)', () => {
    const buf = new NdjsonBuffer(16);
    expect(buf.push('x'.repeat(64))).toEqual([]);
    expect(buf.flush()).toEqual([]);
  });
});
