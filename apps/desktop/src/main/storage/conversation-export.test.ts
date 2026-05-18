import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './db';
import { appendMessage, createConversation } from './conversations';
import { buildConversationExport } from './conversation-export';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

function seedConversation(): string {
  const c = createConversation(
    { title: 'My fancy: chat?', providerId: 'openai', modelId: 'gpt-4o' },
    db,
  );
  appendMessage(
    {
      conversationId: c.id,
      role: 'user',
      content: 'hello there',
      providerId: 'openai',
      modelId: 'gpt-4o',
    },
    db,
  );
  appendMessage(
    {
      conversationId: c.id,
      role: 'assistant',
      content: 'general kenobi',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 12,
      outputTokens: 7,
      costUsd: 0.0012,
    },
    db,
  );
  return c.id;
}

describe('buildConversationExport', () => {
  it('throws when the conversation does not exist', () => {
    expect(() => buildConversationExport('nope', 'markdown', db)).toThrow();
  });

  it('sanitizes filename and uses .md extension for markdown', () => {
    const id = seedConversation();
    const out = buildConversationExport(id, 'markdown', db);
    expect(out.filename.endsWith('.md')).toBe(true);
    expect(out.filename).not.toMatch(/[\\/:*?"<>|]/);
    expect(out.mimeType).toBe('text/markdown');
  });

  it('produces markdown including title, headings, user/assistant content, and usage block', () => {
    const id = seedConversation();
    const out = buildConversationExport(id, 'markdown', db);
    expect(out.content).toContain('# My fancy: chat?');
    expect(out.content).toContain('## Usage');
    expect(out.content).toContain('## User');
    expect(out.content).toContain('hello there');
    expect(out.content).toContain('## Assistant');
    expect(out.content).toContain('general kenobi');
    expect(out.content).toContain('12 in · 7 out');
    expect(out.content).toContain('$0.0012');
    expect(out.content.endsWith('\n')).toBe(true);
  });

  it('produces JSON with schema + conversation + messages + usage', () => {
    const id = seedConversation();
    const out = buildConversationExport(id, 'json', db);
    expect(out.filename.endsWith('.json')).toBe(true);
    expect(out.mimeType).toBe('application/json');
    const parsed = JSON.parse(out.content) as {
      schema: string;
      conversation: { id: string; title: string };
      messages: { role: string; content: string }[];
      usage: { totalInputTokens: number };
    };
    expect(parsed.schema).toBe('opencodex.conversation.v1');
    expect(parsed.conversation.id).toBe(id);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(parsed.usage.totalInputTokens).toBe(12);
  });

  it('omits usage section in markdown when no token data exists', () => {
    const c = createConversation({ title: 'plain' }, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'hi' }, db);
    const out = buildConversationExport(c.id, 'markdown', db);
    expect(out.content).toContain('# plain');
    expect(out.content).not.toContain('## Usage');
  });

  it('falls back to a default filename when title sanitizes to empty', () => {
    const c = createConversation({ title: '???' }, db);
    const out = buildConversationExport(c.id, 'json', db);
    expect(out.filename).toBe('conversation.json');
  });
});
