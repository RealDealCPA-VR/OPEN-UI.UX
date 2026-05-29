import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, setDbForTesting } from './db';
import { appendMessage, createConversation } from './conversations';
import {
  deleteAppliedDiff,
  getAppliedDiff,
  listAppliedDiffs,
  listAppliedDiffsForConversation,
  recordAppliedDiff,
} from './applied-diffs';

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

describe('applied-diffs storage', () => {
  it('records and reads back an applied diff with full provenance', () => {
    const conv = createConversation({ providerId: 'p1', modelId: 'm1' });
    const msg = appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'I will edit the file',
      providerId: 'p1',
      modelId: 'm1',
    });

    const id = recordAppliedDiff({
      conversationId: conv.id,
      messageId: msg.id,
      toolCallId: 'tc-1',
      filePath: 'src/foo.ts',
      diff: '--- old\n+++ new\n@@ @@\n-bar\n+baz\n',
      promptSnapshot: 'Please fix the bar',
      ragCitations: [{ path: 'src/foo.ts', score: 0.8 }],
      routingDecision: { providerId: 'p1', modelId: 'm1', reason: 'cheap' },
      providerId: 'p1',
      modelId: 'm1',
      tokensInput: 100,
      tokensOutput: 50,
      costUsd: 0.001,
      seed: 42,
    });

    const row = getAppliedDiff(id);
    expect(row).not.toBeNull();
    expect(row?.conversationId).toBe(conv.id);
    expect(row?.messageId).toBe(msg.id);
    expect(row?.filePath).toBe('src/foo.ts');
    expect(row?.diff).toContain('bar');
    expect(row?.promptSnapshot).toBe('Please fix the bar');
    expect(row?.providerId).toBe('p1');
    expect(row?.tokensInput).toBe(100);
    expect(row?.tokensOutput).toBe(50);
    expect(row?.costUsd).toBeCloseTo(0.001, 5);
    expect(row?.seed).toBe(42);
    expect(row?.ragCitationsJson).toBeTruthy();
    if (row?.ragCitationsJson) {
      expect(JSON.parse(row.ragCitationsJson)).toEqual([{ path: 'src/foo.ts', score: 0.8 }]);
    }
    expect(row?.routingDecisionJson).toBeTruthy();
    if (row?.routingDecisionJson) {
      expect(JSON.parse(row.routingDecisionJson)).toEqual({
        providerId: 'p1',
        modelId: 'm1',
        reason: 'cheap',
      });
    }
  });

  it('stores nulls for optional provenance fields', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const id = recordAppliedDiff({
      conversationId: conv.id,
      messageId: msg.id,
      filePath: 'a.ts',
      diff: 'diff',
    });
    const row = getAppliedDiff(id);
    expect(row?.toolCallId).toBeNull();
    expect(row?.promptSnapshot).toBeNull();
    expect(row?.ragCitationsJson).toBeNull();
    expect(row?.routingDecisionJson).toBeNull();
    expect(row?.providerId).toBeNull();
    expect(row?.modelId).toBeNull();
    expect(row?.tokensInput).toBeNull();
    expect(row?.tokensOutput).toBeNull();
    expect(row?.costUsd).toBeNull();
    expect(row?.seed).toBeNull();
  });

  it('lists with conversation and file filters and supports pagination', () => {
    const conv1 = createConversation({});
    const conv2 = createConversation({});
    const msg1 = appendMessage({ conversationId: conv1.id, role: 'assistant', content: '' });
    const msg2 = appendMessage({ conversationId: conv2.id, role: 'assistant', content: '' });

    for (let i = 0; i < 3; i++) {
      recordAppliedDiff({
        conversationId: conv1.id,
        messageId: msg1.id,
        filePath: `a${i}.ts`,
        diff: 'd',
      });
    }
    recordAppliedDiff({
      conversationId: conv2.id,
      messageId: msg2.id,
      filePath: 'b.ts',
      diff: 'd',
    });

    const all = listAppliedDiffs({});
    expect(all.total).toBe(4);

    const byConv = listAppliedDiffs({ conversationId: conv1.id });
    expect(byConv.total).toBe(3);
    expect(byConv.rows.every((r) => r.conversationId === conv1.id)).toBe(true);

    const byFile = listAppliedDiffs({ filePath: 'b.ts' });
    expect(byFile.total).toBe(1);
    expect(byFile.rows[0]?.conversationId).toBe(conv2.id);

    const limited = listAppliedDiffs({ conversationId: conv1.id, limit: 2, offset: 0 });
    expect(limited.rows).toHaveLength(2);
    expect(limited.total).toBe(3);
  });

  it('returns null for missing ids and deletes rows', () => {
    expect(getAppliedDiff('does-not-exist')).toBeNull();
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const id = recordAppliedDiff({
      conversationId: conv.id,
      messageId: msg.id,
      filePath: 'x.ts',
      diff: 'd',
    });
    expect(getAppliedDiff(id)).not.toBeNull();
    deleteAppliedDiff(id);
    expect(getAppliedDiff(id)).toBeNull();
  });

  it('returns conversation-scoped diffs in chronological order', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const ids = ['a.ts', 'b.ts', 'c.ts'].map((p) =>
      recordAppliedDiff({
        conversationId: conv.id,
        messageId: msg.id,
        filePath: p,
        diff: 'd',
      }),
    );
    const rows = listAppliedDiffsForConversation(conv.id);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });
});
