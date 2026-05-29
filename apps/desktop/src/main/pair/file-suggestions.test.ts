import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../shared/conversation';
import type { PairSuggestionEvent } from '../../shared/pair';
import { FileSuggestionsEngine, type WatcherBatchLike } from './file-suggestions';

function makeMsg(content: string, role: StoredMessage['role'] = 'assistant'): StoredMessage {
  return {
    id: Math.random().toString(36).slice(2),
    conversationId: 'conv-1',
    role,
    content,
    contentBlocks: null,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    createdAt: new Date().toISOString(),
  };
}

function emptyBatch(overrides: Partial<WatcherBatchLike> = {}): WatcherBatchLike {
  return { added: [], changed: [], removed: [], ...overrides };
}

describe('FileSuggestionsEngine', () => {
  it('emits nothing when no active conversation', () => {
    const captured: PairSuggestionEvent[] = [];
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => null,
      getMessagesForConversation: () => [],
      onSuggestion: (e) => captured.push(e),
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(result).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it('emits nothing when no messages reference the changed path', () => {
    const captured: PairSuggestionEvent[] = [];
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('something about src/bar.ts:1')],
      onSuggestion: (e) => captured.push(e),
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(result).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it('emits an edit suggestion when a changed path matches a recent citation', () => {
    const captured: PairSuggestionEvent[] = [];
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('check out src/foo.ts:42 — it has the bug')],
      onSuggestion: (e) => captured.push(e),
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item).toBeDefined();
    if (!item) return;
    expect(item.changeKind).toBe('edit');
    expect(item.filePath).toBe('src/foo.ts');
    expect(item.conversationId).toBe('conv-1');
    expect(captured).toHaveLength(1);
  });

  it('emits create and delete suggestions for added and removed paths', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('see src/a.ts:1 and src/b.ts:2')],
    });
    const result = engine.ingestBatch(emptyBatch({ added: ['src/a.ts'], removed: ['src/b.ts'] }));
    expect(result.map((s) => s.changeKind).sort()).toEqual(['create', 'delete']);
  });

  it('only considers the last 20 messages of the conversation', () => {
    const oldMsgs = Array.from({ length: 5 }, (_, i) =>
      makeMsg(`old paragraph ${i} mentioning src/legacy.ts:1`),
    );
    const fillerMsgs = Array.from({ length: 20 }, (_, i) =>
      makeMsg(`recent unrelated message ${i}`),
    );
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [...oldMsgs, ...fillerMsgs],
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/legacy.ts'] }));
    expect(result).toHaveLength(0);
  });

  it('lists queued suggestions per conversation', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('src/foo.ts:1')],
    });
    engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(engine.listForConversation('conv-1')).toHaveLength(1);
    expect(engine.listForConversation('conv-2')).toHaveLength(0);
  });

  it('dismisses a suggestion by id', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('src/foo.ts:1')],
    });
    const [created] = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(created).toBeDefined();
    if (!created) return;
    expect(engine.dismiss(created.id)).toBe(true);
    expect(engine.listForConversation('conv-1')).toHaveLength(0);
    expect(engine.dismiss(created.id)).toBe(false);
  });

  it('findSuggestion looks across all buckets', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('src/foo.ts:1')],
    });
    const [created] = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(created).toBeDefined();
    if (!created) return;
    const found = engine.findSuggestion(created.id);
    expect(found?.id).toBe(created.id);
    expect(engine.findSuggestion('does-not-exist')).toBeUndefined();
  });

  it('respects normalized path matching (windows-style separators)', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('look at src\\foo.ts:5')],
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(result).toHaveLength(1);
  });

  it('rejects citations with ".." segments', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('see ../etc/passwd.ts:1')],
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['../etc/passwd.ts'] }));
    expect(result).toHaveLength(0);
  });

  it('rejects bare paths with ".." segments', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('look at ../../secret.ts and other notes')],
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['../../secret.ts'] }));
    expect(result).toHaveLength(0);
  });

  it('rejects paths with embedded ".." segments after backslash normalization', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('hidden src\\..\\..\\etc\\passwd.ts:9')],
    });
    const result = engine.ingestBatch(emptyBatch({ changed: ['src/../../etc/passwd.ts'] }));
    expect(result).toHaveLength(0);
  });

  it('reset() drops all buckets', () => {
    const engine = new FileSuggestionsEngine({
      getActiveConversationId: () => 'conv-1',
      getMessagesForConversation: () => [makeMsg('src/foo.ts:1')],
    });
    engine.ingestBatch(emptyBatch({ changed: ['src/foo.ts'] }));
    expect(engine.listForConversation('conv-1')).toHaveLength(1);
    engine.reset();
    expect(engine.listForConversation('conv-1')).toHaveLength(0);
  });
});
