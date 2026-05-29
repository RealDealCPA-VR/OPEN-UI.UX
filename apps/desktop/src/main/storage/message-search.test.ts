import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './db';
import { appendMessage, createConversation } from './conversations';
import {
  indexMessageInFts,
  rebuildMessageFts,
  removeMessageFromFts,
  searchMessages,
} from './message-search';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

function seed(
  content: string,
  role: 'user' | 'assistant' = 'user',
): {
  conversationId: string;
  messageId: string;
} {
  const c = createConversation({ title: 'Test convo' }, db);
  const m = appendMessage({ conversationId: c.id, role, content }, db);
  indexMessageInFts(m.id, c.id, content, db);
  return { conversationId: c.id, messageId: m.id };
}

describe('searchMessages', () => {
  it('returns empty for blank query', () => {
    expect(searchMessages('', {}, db)).toEqual([]);
    expect(searchMessages('   ', {}, db)).toEqual([]);
  });

  it('returns no rows when nothing has been indexed', () => {
    expect(searchMessages('hello', {}, db)).toEqual([]);
  });

  it('finds a single match with bm25 ranking and snippet', () => {
    const { conversationId, messageId } = seed('The quick brown fox jumps over the lazy dog');
    const hits = searchMessages('fox', {}, db);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.conversationId).toBe(conversationId);
    expect(hits[0]?.messageId).toBe(messageId);
    expect(hits[0]?.snippet).toContain('[[fox]]');
    expect(hits[0]?.conversationTitle).toBe('Test convo');
  });

  it('supports prefix matching across whitespace-separated tokens', () => {
    seed('Migrate to vector store with embeddings');
    const hits = searchMessages('vec embed', {}, db);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('orders results by bm25 score ascending (best matches first)', () => {
    const a = seed('alpha alpha alpha beta');
    seed('alpha beta beta beta');
    const hits = searchMessages('alpha', {}, db);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.messageId).toBe(a.messageId);
  });

  it('filters to a single conversation when conversationId is provided', () => {
    const a = seed('only-in-a needle here');
    const b = seed('only-in-b needle here');
    const hits = searchMessages('needle', { conversationId: a.conversationId }, db);
    expect(hits.map((h) => h.messageId)).toEqual([a.messageId]);
    expect(hits.every((h) => h.conversationId !== b.conversationId)).toBe(true);
  });

  it('respects the limit option', () => {
    for (let i = 0; i < 10; i++) seed(`apple banana orange #${i}`);
    const hits = searchMessages('apple', { limit: 3 }, db);
    expect(hits).toHaveLength(3);
  });

  it('survives FTS-special characters in user input', () => {
    seed('hello "world" with (parens) and *stars*');
    expect(() => searchMessages('"world"', {}, db)).not.toThrow();
    expect(() => searchMessages('*stars*', {}, db)).not.toThrow();
  });

  it('does not match content after removeMessageFromFts', () => {
    const { messageId } = seed('disappearing trace');
    removeMessageFromFts(messageId, db);
    expect(searchMessages('disappearing', {}, db)).toEqual([]);
  });

  it('replaces an entry when indexMessageInFts is called twice for the same id', () => {
    const { messageId, conversationId } = seed('first content');
    indexMessageInFts(messageId, conversationId, 'second content', db);
    expect(searchMessages('first', {}, db)).toEqual([]);
    const hits = searchMessages('second', {}, db);
    expect(hits).toHaveLength(1);
  });
});

describe('rebuildMessageFts', () => {
  it('reindexes all messages from the messages table after the FTS index was wiped', () => {
    const c = createConversation({ title: 'Rebuild me' }, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'persisted alpha' }, db);
    appendMessage({ conversationId: c.id, role: 'assistant', content: 'persisted beta' }, db);
    // appendMessage already auto-mirrors into messages_fts, so the rows are
    // searchable immediately. Simulate FTS corruption / drop so the rebuild
    // is observable.
    db.exec('DELETE FROM messages_fts');
    expect(searchMessages('alpha', {}, db)).toEqual([]);
    rebuildMessageFts(db);
    expect(searchMessages('alpha', {}, db)).toHaveLength(1);
    expect(searchMessages('beta', {}, db)).toHaveLength(1);
  });
});
