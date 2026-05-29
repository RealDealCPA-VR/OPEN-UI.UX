import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../shared/conversation';
import { messageBubblePropsEqual } from './ChatView';

function msg(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'hello world',
    contentBlocks: null,
    providerId: 'openai',
    modelId: 'gpt-4o',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.0001,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('messageBubblePropsEqual', () => {
  const onRerun = (): void => {};

  it('skips re-render when message identity + onRerun ref are stable', () => {
    const m = msg();
    expect(messageBubblePropsEqual({ message: m, onRerun }, { message: m, onRerun })).toBe(true);
  });

  it('re-renders when onRerun reference changes', () => {
    const m = msg();
    const onRerunB = (): void => {};
    expect(
      messageBubblePropsEqual({ message: m, onRerun }, { message: m, onRerun: onRerunB }),
    ).toBe(false);
  });

  it('re-renders when message content changes', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ content: 'a' }), onRerun },
        { message: msg({ content: 'b' }), onRerun },
      ),
    ).toBe(false);
  });

  it('re-renders when contentBlocks reference changes', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ contentBlocks: [{ type: 'text', text: 'x' }] }), onRerun },
        { message: msg({ contentBlocks: [{ type: 'text', text: 'x' }] }), onRerun },
      ),
    ).toBe(false);
  });

  it('skips re-render on a clone with identical primitive fields and same blocks ref', () => {
    const blocks = [{ type: 'text' as const, text: 'x' }];
    const a = msg({ contentBlocks: blocks });
    const b = msg({ contentBlocks: blocks });
    expect(messageBubblePropsEqual({ message: a, onRerun }, { message: b, onRerun })).toBe(true);
  });

  it('re-renders when usage fields change (token settle after stream done)', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ inputTokens: null, outputTokens: null }), onRerun },
        { message: msg({ inputTokens: 42, outputTokens: 7 }), onRerun },
      ),
    ).toBe(false);
  });
});
