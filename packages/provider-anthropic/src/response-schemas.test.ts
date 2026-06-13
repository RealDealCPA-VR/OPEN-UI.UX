import { describe, expect, it } from 'vitest';
import { streamEventSchema } from './response-schemas';

describe('streamEventSchema', () => {
  it('parses message_delta with refusal/pause_turn/context-window stop reasons', () => {
    for (const reason of ['refusal', 'pause_turn', 'model_context_window_exceeded']) {
      const result = streamEventSchema.safeParse({
        type: 'message_delta',
        delta: { stop_reason: reason, stop_sequence: null },
        usage: { output_tokens: 42 },
      });
      expect(result.success).toBe(true);
    }
  });

  it('parses message_delta with an unknown future stop reason (string catchall)', () => {
    const result = streamEventSchema.safeParse({
      type: 'message_delta',
      delta: { stop_reason: 'brand_new_reason' },
      usage: { output_tokens: 7 },
    });
    expect(result.success).toBe(true);
  });

  it('parses thinking and redacted_thinking content_block_start events', () => {
    expect(
      streamEventSchema.safeParse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      }).success,
    ).toBe(true);
    expect(
      streamEventSchema.safeParse({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'redacted_thinking', data: 'opaque' },
      }).success,
    ).toBe(true);
  });

  it('parses thinking_delta and signature_delta content_block_delta events', () => {
    expect(
      streamEventSchema.safeParse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'hmm' },
      }).success,
    ).toBe(true);
    expect(
      streamEventSchema.safeParse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'abc==' },
      }).success,
    ).toBe(true);
  });
});
