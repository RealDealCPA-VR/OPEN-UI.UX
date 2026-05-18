import { describe, expect, it } from 'vitest';
import { chatEventSchema } from './events';
import { contentBlockSchema, messageSchema } from './message';
import { modelCapabilitiesSchema } from './capabilities';

describe('chatEventSchema', () => {
  it('parses every variant of the union', () => {
    expect(chatEventSchema.parse({ type: 'text_delta', delta: 'hi' }).type).toBe('text_delta');
    expect(
      chatEventSchema.parse({ type: 'tool_call', id: '1', name: 'read', arguments: {} }).type,
    ).toBe('tool_call');
    expect(
      chatEventSchema.parse({ type: 'tool_result', id: '1', output: 'ok', isError: false }).type,
    ).toBe('tool_result');
    expect(chatEventSchema.parse({ type: 'usage', inputTokens: 5, outputTokens: 10 }).type).toBe(
      'usage',
    );
    expect(chatEventSchema.parse({ type: 'done', stopReason: 'end_turn' }).type).toBe('done');
    expect(chatEventSchema.parse({ type: 'error', message: 'oops', retryable: true }).type).toBe(
      'error',
    );
  });

  it('rejects unknown event types', () => {
    expect(chatEventSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('rejects negative token counts', () => {
    expect(
      chatEventSchema.safeParse({ type: 'usage', inputTokens: -1, outputTokens: 0 }).success,
    ).toBe(false);
  });
});

describe('messageSchema', () => {
  it('accepts string content', () => {
    expect(messageSchema.parse({ role: 'user', content: 'hello' }).role).toBe('user');
  });

  it('accepts block array content', () => {
    const parsed = messageSchema.parse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'a', name: 'read_file', arguments: { path: '/x' } },
      ],
    });
    expect(Array.isArray(parsed.content)).toBe(true);
  });

  it('rejects invalid role', () => {
    expect(messageSchema.safeParse({ role: 'bot', content: 'x' }).success).toBe(false);
  });

  it('rejects unknown content block type', () => {
    expect(contentBlockSchema.safeParse({ type: 'video', url: 'x' }).success).toBe(false);
  });
});

describe('modelCapabilitiesSchema', () => {
  it('parses a minimal capability', () => {
    const parsed = modelCapabilitiesSchema.parse({
      id: 'gpt-4o',
      providerId: 'openai',
      displayName: 'GPT-4o',
      contextWindow: 128_000,
      toolUse: true,
      vision: true,
      streaming: true,
      embeddings: false,
    });
    expect(parsed.contextWindow).toBe(128_000);
  });

  it('rejects zero context window', () => {
    expect(
      modelCapabilitiesSchema.safeParse({
        id: 'x',
        providerId: 'x',
        displayName: 'x',
        contextWindow: 0,
        toolUse: false,
        vision: false,
        streaming: false,
        embeddings: false,
      }).success,
    ).toBe(false);
  });
});
