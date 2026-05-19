import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, appendMessage } from './conversations';
import { applyMigrations, setDbForTesting } from './db';
import { listToolCallsForMessage, recordToolCall } from './tool-audit';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('recordToolCall', () => {
  it('writes a row that can be read back', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a.ts' },
      output: 'file contents',
      decision: 'auto',
      isError: false,
      durationMs: 42,
    });

    const rows = listToolCallsForMessage(msg.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a.ts' },
      output: 'file contents',
      decision: 'auto',
      isError: false,
      durationMs: 42,
    });
    expect(rows[0]?.id).toBeTruthy();
    expect(rows[0]?.createdAt).toBeTruthy();
  });

  it('preserves error flag, denial decision, and null duration', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'write_file',
      input: { path: 'a.ts', content: 'x' },
      output: 'denied',
      decision: 'denied',
      isError: true,
      durationMs: null,
    });

    const rows = listToolCallsForMessage(msg.id);
    expect(rows[0]?.isError).toBe(true);
    expect(rows[0]?.decision).toBe('denied');
    expect(rows[0]?.durationMs).toBeNull();
  });

  it('records multiple calls for the same message in insertion order', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a' },
      output: 'one',
      decision: 'auto',
      isError: false,
      durationMs: 1,
    });
    recordToolCall({
      messageId: msg.id,
      toolName: 'grep',
      input: { pattern: 'todo' },
      output: 'two',
      decision: 'auto',
      isError: false,
      durationMs: 2,
    });

    const rows = listToolCallsForMessage(msg.id);
    expect(rows.map((r) => r.toolName)).toEqual(['read_file', 'grep']);
  });

  it('cascade-deletes when the parent message is deleted', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a' },
      output: 'x',
      decision: 'auto',
      isError: false,
      durationMs: 1,
    });

    db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
    expect(listToolCallsForMessage(msg.id)).toHaveLength(0);
  });
});
