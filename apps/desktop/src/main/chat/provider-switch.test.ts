import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { applyMigrations, setDbForTesting } from '../storage/db';
import { appendMessage, createConversation, getConversation } from '../storage/conversations';
import { buildResendSummary, switchProvider } from './provider-switch';

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

describe('switchProvider', () => {
  it('updates the conversation provider_id and model_id', () => {
    const c = createConversation({ providerId: 'openai', modelId: 'gpt-4o' }, db);
    const res = switchProvider(
      {
        conversationId: c.id,
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        resendStrategy: 'summary-only',
      },
      db,
    );
    expect(res.providerId).toBe('anthropic');
    expect(res.modelId).toBe('claude-3-5-sonnet');
    const refetched = getConversation(c.id, db);
    expect(refetched?.providerId).toBe('anthropic');
    expect(refetched?.modelId).toBe('claude-3-5-sonnet');
  });

  it('produces a non-empty summary when resendStrategy=summary-only and history exists', () => {
    const c = createConversation({ providerId: 'openai', modelId: 'gpt-4o' }, db);
    appendMessage(
      { conversationId: c.id, role: 'user', content: 'Refactor the auth module to use JWT' },
      db,
    );
    appendMessage(
      {
        conversationId: c.id,
        role: 'assistant',
        content: 'Identified four call sites; will replace cookie-session with jwt verify.',
      },
      db,
    );

    const res = switchProvider(
      {
        conversationId: c.id,
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        resendStrategy: 'summary-only',
      },
      db,
    );
    expect(res.summary).not.toBeNull();
    expect(res.summary).toContain('Refactor the auth module');
  });

  it('returns null summary when resendStrategy=full-history', () => {
    const c = createConversation({ providerId: 'openai', modelId: 'gpt-4o' }, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'hello' }, db);
    const res = switchProvider(
      {
        conversationId: c.id,
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        resendStrategy: 'full-history',
      },
      db,
    );
    expect(res.summary).toBeNull();
  });

  it('throws when conversation does not exist', () => {
    expect(() =>
      switchProvider(
        {
          conversationId: 'nope',
          providerId: 'p',
          modelId: 'm',
          resendStrategy: 'summary-only',
        },
        db,
      ),
    ).toThrow(/not found/);
  });
});

describe('buildResendSummary', () => {
  it('returns an empty string for an empty conversation', () => {
    const c = createConversation({}, db);
    expect(buildResendSummary(c.id, db)).toBe('');
  });

  it('includes recent user and assistant turns', () => {
    const c = createConversation({}, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'A' }, db);
    appendMessage({ conversationId: c.id, role: 'assistant', content: 'B' }, db);
    const summary = buildResendSummary(c.id, db);
    expect(summary).toContain('Recent user turns');
    expect(summary).toContain('Recent assistant turns');
    expect(summary).toContain('A');
    expect(summary).toContain('B');
  });

  it('truncates long content', () => {
    const c = createConversation({}, db);
    appendMessage({ conversationId: c.id, role: 'user', content: 'x'.repeat(2000) }, db);
    const summary = buildResendSummary(c.id, db);
    expect(summary.length).toBeLessThanOrEqual(1800);
  });
});
