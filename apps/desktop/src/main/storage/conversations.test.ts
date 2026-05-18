import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './db';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversation,
  getConversationUsage,
  listConversations,
  listMessages,
  renameConversation,
  updateAssistantMessage,
} from './conversations';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

describe('conversations storage', () => {
  it('creates a conversation with default title when none is given', () => {
    const c = createConversation({}, db);
    expect(c.title).toBe('New conversation');
    expect(c.providerId).toBeNull();
    expect(c.modelId).toBeNull();
    expect(c.createdAt).toBeTruthy();
    expect(c.updatedAt).toBeTruthy();
  });

  it('creates a conversation with provider/model and custom title', () => {
    const c = createConversation({ title: 'My chat', providerId: 'openai', modelId: 'gpt-4o' }, db);
    expect(c.title).toBe('My chat');
    expect(c.providerId).toBe('openai');
    expect(c.modelId).toBe('gpt-4o');
  });

  it('lists conversations newest first by updated_at', async () => {
    const a = createConversation({ title: 'first' }, db);
    await new Promise((r) => setTimeout(r, 10));
    const b = createConversation({ title: 'second' }, db);
    const list = listConversations(db);
    expect(list.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it('renames a conversation and bumps updated_at', async () => {
    const c = createConversation({ title: 'old' }, db);
    await new Promise((r) => setTimeout(r, 5));
    const renamed = renameConversation(c.id, 'shiny new', db);
    expect(renamed.title).toBe('shiny new');
    expect(renamed.updatedAt >= c.updatedAt).toBe(true);
  });

  it('rejects renaming a nonexistent conversation', () => {
    expect(() => renameConversation('does-not-exist', 'x', db)).toThrow();
  });

  it('rejects empty titles on rename', () => {
    const c = createConversation({}, db);
    expect(() => renameConversation(c.id, '   ', db)).toThrow();
  });

  it('deletes a conversation and cascades to messages', () => {
    const c = createConversation({}, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'hi' }, db);
    deleteConversation(c.id, db);
    expect(getConversation(c.id, db)).toBeNull();
    expect(listMessages(c.id, db)).toEqual([]);
  });

  it('appends a message and updates conversation updated_at', async () => {
    const c = createConversation({}, db);
    const original = c.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const m = appendMessage({ conversationId: c.id, role: 'user', content: 'hello' }, db);
    expect(m.role).toBe('user');
    expect(m.content).toBe('hello');
    const after = getConversation(c.id, db);
    expect(after?.updatedAt).not.toBe(original);
  });

  it('lists messages in insertion order', () => {
    const c = createConversation({}, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'one' }, db);
    appendMessage({ conversationId: c.id, role: 'assistant', content: 'two' }, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'three' }, db);
    const msgs = listMessages(c.id, db);
    expect(msgs.map((m) => m.content)).toEqual(['one', 'two', 'three']);
  });

  it('refuses to append messages to a missing conversation', () => {
    expect(() =>
      appendMessage({ conversationId: 'nope', role: 'user', content: 'hi' }, db),
    ).toThrow();
  });

  it('updates assistant message content and usage', () => {
    const c = createConversation({}, db);
    const m = appendMessage({ conversationId: c.id, role: 'assistant', content: '' }, db);
    const updated = updateAssistantMessage(
      m.id,
      { content: 'hello world', inputTokens: 10, outputTokens: 20, costUsd: 0.0012 },
      db,
    );
    expect(updated.content).toBe('hello world');
    expect(updated.inputTokens).toBe(10);
    expect(updated.outputTokens).toBe(20);
    expect(updated.costUsd).toBeCloseTo(0.0012);
  });

  describe('getConversationUsage', () => {
    it('returns zeros for a conversation with no usage rows', () => {
      const c = createConversation({}, db);
      appendMessage({ conversationId: c.id, role: 'user', content: 'hi' }, db);
      const u = getConversationUsage(c.id, db);
      expect(u.conversationId).toBe(c.id);
      expect(u.messageCount).toBe(0);
      expect(u.totalInputTokens).toBe(0);
      expect(u.totalOutputTokens).toBe(0);
      expect(u.totalCostUsd).toBe(0);
      expect(u.byModel).toEqual([]);
    });

    it('sums tokens and cost across multiple assistant messages', () => {
      const c = createConversation({}, db);
      appendMessage({ conversationId: c.id, role: 'user', content: 'q1' }, db);
      appendMessage(
        {
          conversationId: c.id,
          role: 'assistant',
          content: 'a1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.005,
        },
        db,
      );
      appendMessage(
        {
          conversationId: c.id,
          role: 'assistant',
          content: 'a2',
          providerId: 'openai',
          modelId: 'gpt-4o',
          inputTokens: 200,
          outputTokens: 80,
          costUsd: 0.01,
        },
        db,
      );
      const u = getConversationUsage(c.id, db);
      expect(u.messageCount).toBe(2);
      expect(u.totalInputTokens).toBe(300);
      expect(u.totalOutputTokens).toBe(130);
      expect(u.totalCostUsd).toBeCloseTo(0.015);
      expect(u.byModel).toHaveLength(1);
      expect(u.byModel[0]).toMatchObject({
        providerId: 'openai',
        modelId: 'gpt-4o',
        messageCount: 2,
        inputTokens: 300,
        outputTokens: 130,
      });
    });

    it('groups by provider + model', () => {
      const c = createConversation({}, db);
      appendMessage(
        {
          conversationId: c.id,
          role: 'assistant',
          content: 'a',
          providerId: 'openai',
          modelId: 'gpt-4o',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.001,
        },
        db,
      );
      appendMessage(
        {
          conversationId: c.id,
          role: 'assistant',
          content: 'b',
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet',
          inputTokens: 20,
          outputTokens: 8,
          costUsd: 0.004,
        },
        db,
      );
      const u = getConversationUsage(c.id, db);
      expect(u.byModel).toHaveLength(2);
      const byKey = new Map(u.byModel.map((r) => [`${r.providerId}/${r.modelId}`, r]));
      expect(byKey.get('openai/gpt-4o')?.inputTokens).toBe(10);
      expect(byKey.get('anthropic/claude-3-5-sonnet')?.inputTokens).toBe(20);
    });

    it('excludes messages with no token or cost info', () => {
      const c = createConversation({}, db);
      appendMessage({ conversationId: c.id, role: 'user', content: 'q' }, db);
      appendMessage(
        {
          conversationId: c.id,
          role: 'assistant',
          content: 'a',
          providerId: 'openai',
          modelId: 'gpt-4o',
          inputTokens: 5,
          outputTokens: 5,
          costUsd: 0.001,
        },
        db,
      );
      const u = getConversationUsage(c.id, db);
      expect(u.messageCount).toBe(1);
    });
  });

  it('persists provider/model metadata on messages', () => {
    const c = createConversation({}, db);
    const m = appendMessage(
      {
        conversationId: c.id,
        role: 'assistant',
        content: 'ok',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
      },
      db,
    );
    expect(m.providerId).toBe('anthropic');
    expect(m.modelId).toBe('claude-3-5-sonnet');
  });
});
