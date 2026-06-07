import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../shared/conversation';
import { extractFilePathsFromMessages, lastUserMessageText } from './extract-file-paths';

function makeMsg(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: '',
    contentBlocks: null,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00Z',
    turnStatus: 'final',
    ...overrides,
  };
}

describe('extractFilePathsFromMessages', () => {
  it('returns empty when there are no messages', () => {
    expect(extractFilePathsFromMessages([])).toEqual([]);
  });

  it('skips user messages by default', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'see src/foo.ts:10' }),
      makeMsg({ id: 'a1', role: 'assistant', content: 'I read src/bar.ts:5 and it was fine' }),
    ];
    expect(extractFilePathsFromMessages(msgs)).toEqual(['src/bar.ts']);
  });

  it('includes user messages when assistantOnly:false', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'check src/foo.ts:10 please' }),
      makeMsg({ id: 'a1', role: 'assistant', content: 'looked at src/bar.ts:5' }),
    ];
    const out = extractFilePathsFromMessages(msgs, { assistantOnly: false });
    expect(out).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('dedupes paths while preserving first-seen order', () => {
    const msgs = [
      makeMsg({ id: 'a1', content: 'edited src/a.ts:1 and src/b.ts:2 then src/a.ts:9' }),
      makeMsg({ id: 'a2', content: 'src/c.ts:5 and src/a.ts:50' }),
    ];
    expect(extractFilePathsFromMessages(msgs)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('respects the limit option', () => {
    const msgs = [makeMsg({ id: 'a1', content: 'src/a.ts:1 src/b.ts:1 src/c.ts:1 src/d.ts:1' })];
    expect(extractFilePathsFromMessages(msgs, { limit: 2 })).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('skips messages without content', () => {
    const msgs = [makeMsg({ id: 'a1', content: '' })];
    expect(extractFilePathsFromMessages(msgs)).toEqual([]);
  });
});

describe('lastUserMessageText', () => {
  it('returns the most recent user message text', () => {
    const msgs = [
      makeMsg({ id: 'u1', role: 'user', content: 'first' }),
      makeMsg({ id: 'a1', role: 'assistant', content: 'reply' }),
      makeMsg({ id: 'u2', role: 'user', content: 'second' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'reply2' }),
    ];
    expect(lastUserMessageText(msgs)).toBe('second');
  });

  it('returns empty string when no user messages', () => {
    expect(lastUserMessageText([])).toBe('');
    const msgs = [makeMsg({ id: 'a1', role: 'assistant', content: 'hi' })];
    expect(lastUserMessageText(msgs)).toBe('');
  });
});
