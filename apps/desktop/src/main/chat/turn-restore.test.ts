import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { appendMessage, createConversation, listMessages } from '../storage/conversations';
import {
  __resetForTests,
  consumeInterruptedTurn,
  listInterruptedTurns,
  reconcileInterruptedTurns,
} from './turn-restore';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  setDbForTesting(null);
  db.close();
});

describe('reconcileInterruptedTurns', () => {
  it('flips a streaming assistant row to final, preserving content verbatim', () => {
    const conv = createConversation({}, db);
    const partial = appendMessage(
      {
        conversationId: conv.id,
        role: 'assistant',
        content: 'half an answer',
        turnStatus: 'streaming',
      },
      db,
    );

    reconcileInterruptedTurns();

    const rows = listMessages(conv.id, db);
    const row = rows.find((m) => m.id === partial.id);
    expect(row?.turnStatus).toBe('final');
    expect(row?.content).toBe('half an answer');
  });

  it('records interrupted turns so listInterruptedTurns reports them', () => {
    const conv = createConversation({}, db);
    const partial = appendMessage(
      {
        conversationId: conv.id,
        role: 'assistant',
        content: 'partial',
        turnStatus: 'streaming',
      },
      db,
    );

    reconcileInterruptedTurns();

    const list = listInterruptedTurns();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      conversationId: conv.id,
      assistantMessageId: partial.id,
    });
  });

  it('leaves clean final rows untouched and reports nothing', () => {
    const conv = createConversation({}, db);
    appendMessage(
      { conversationId: conv.id, role: 'assistant', content: 'done', turnStatus: 'final' },
      db,
    );

    reconcileInterruptedTurns();

    expect(listInterruptedTurns()).toHaveLength(0);
  });

  it('consumeInterruptedTurn removes and returns the record once', () => {
    const conv = createConversation({}, db);
    const partial = appendMessage(
      {
        conversationId: conv.id,
        role: 'assistant',
        content: 'partial',
        turnStatus: 'streaming',
      },
      db,
    );

    reconcileInterruptedTurns();

    const first = consumeInterruptedTurn(conv.id);
    expect(first).toEqual({ conversationId: conv.id, assistantMessageId: partial.id });
    expect(consumeInterruptedTurn(conv.id)).toBeNull();
    expect(listInterruptedTurns()).toHaveLength(0);
  });
});
