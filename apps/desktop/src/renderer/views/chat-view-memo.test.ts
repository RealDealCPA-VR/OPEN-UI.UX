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
    cachedInputTokens: null,
    costUsd: 0.0001,
    createdAt: '2026-01-01T00:00:00.000Z',
    turnStatus: 'final',
    ...overrides,
  };
}

describe('messageBubblePropsEqual', () => {
  const onRerun = (): void => {};
  const onRegenerate = (): void => {};
  const onEdit = (): void => {};
  const cb = { onRerun, onRegenerate, onEdit };

  it('skips re-render when message identity + callback refs are stable', () => {
    const m = msg();
    expect(messageBubblePropsEqual({ message: m, ...cb }, { message: m, ...cb })).toBe(true);
  });

  it('re-renders when onRerun reference changes', () => {
    const m = msg();
    const onRerunB = (): void => {};
    expect(
      messageBubblePropsEqual({ message: m, ...cb }, { message: m, ...cb, onRerun: onRerunB }),
    ).toBe(false);
  });

  it('re-renders when onRegenerate reference changes', () => {
    const m = msg();
    const onRegenerateB = (): void => {};
    expect(
      messageBubblePropsEqual(
        { message: m, ...cb },
        { message: m, ...cb, onRegenerate: onRegenerateB },
      ),
    ).toBe(false);
  });

  it('re-renders when onEdit reference changes', () => {
    const m = msg();
    const onEditB = (): void => {};
    expect(
      messageBubblePropsEqual({ message: m, ...cb }, { message: m, ...cb, onEdit: onEditB }),
    ).toBe(false);
  });

  it('re-renders when message content changes', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ content: 'a' }), ...cb },
        { message: msg({ content: 'b' }), ...cb },
      ),
    ).toBe(false);
  });

  it('re-renders when contentBlocks reference changes', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ contentBlocks: [{ type: 'text', text: 'x' }] }), ...cb },
        { message: msg({ contentBlocks: [{ type: 'text', text: 'x' }] }), ...cb },
      ),
    ).toBe(false);
  });

  it('skips re-render on a clone with identical primitive fields and same blocks ref', () => {
    const blocks = [{ type: 'text' as const, text: 'x' }];
    const a = msg({ contentBlocks: blocks });
    const b = msg({ contentBlocks: blocks });
    expect(messageBubblePropsEqual({ message: a, ...cb }, { message: b, ...cb })).toBe(true);
  });

  it('re-renders when usage fields change (token settle after stream done)', () => {
    expect(
      messageBubblePropsEqual(
        { message: msg({ inputTokens: null, outputTokens: null }), ...cb },
        { message: msg({ inputTokens: 42, outputTokens: 7 }), ...cb },
      ),
    ).toBe(false);
  });
});
