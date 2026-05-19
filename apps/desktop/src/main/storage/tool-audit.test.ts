import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_CALL_AUDIT_PAYLOAD_LIMIT } from '../../shared/tool-audit';
import { createConversation, appendMessage } from './conversations';
import { applyMigrations, setDbForTesting } from './db';
import {
  clearAllToolCalls,
  listToolCallsForMessage,
  purgeToolCallsOlderThan,
  queryToolCalls,
  recordToolCall,
} from './tool-audit';

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

describe('queryToolCalls', () => {
  function seed(): { convA: string; convB: string } {
    const convA = createConversation({ title: 'Alpha' });
    const convB = createConversation({ title: 'Beta' });
    const msgA = appendMessage({ conversationId: convA.id, role: 'assistant', content: '' });
    const msgB = appendMessage({ conversationId: convB.id, role: 'assistant', content: '' });

    // Insert with explicit timestamps so ordering is deterministic.
    const insert = db.prepare(
      `INSERT INTO tool_calls
         (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'r1',
      msgA.id,
      'read_file',
      '{"path":"a"}',
      '"hi"',
      'auto',
      0,
      5,
      '2026-05-19 09:00:00',
    );
    insert.run(
      'r2',
      msgA.id,
      'write_file',
      '{"path":"b"}',
      '"ok"',
      'prompt-allowed',
      0,
      12,
      '2026-05-19 10:00:00',
    );
    insert.run(
      'r3',
      msgB.id,
      'run_shell',
      '{"cmd":"ls"}',
      null,
      'denied',
      1,
      null,
      '2026-05-19 11:00:00',
    );
    insert.run(
      'r4',
      msgB.id,
      'read_file',
      '{"path":"c"}',
      '"x"',
      'auto',
      0,
      1,
      '2026-05-19 12:00:00',
    );
    insert.run(
      'r5',
      msgB.id,
      'web_fetch',
      '{"url":"u"}',
      '"timeout"',
      'auto',
      1,
      30000,
      '2026-05-19 13:00:00',
    );

    return { convA: convA.id, convB: convB.id };
  }

  it('returns rows newest-first with conversation join + facets', () => {
    seed();
    const result = queryToolCalls({});
    expect(result.rows.map((r) => r.id)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']);
    expect(result.rows[0]?.conversationTitle).toBe('Beta');
    expect(result.rows[4]?.conversationTitle).toBe('Alpha');
    expect(result.total).toBe(5);
    expect(result.facets.toolNames).toEqual(['read_file', 'run_shell', 'web_fetch', 'write_file']);
    expect(result.facets.decisions.sort()).toEqual(['auto', 'denied', 'prompt-allowed']);
  });

  it('filters by toolName, decision, errorState, and time range', () => {
    seed();
    expect(queryToolCalls({ toolNames: ['read_file'] }).rows.map((r) => r.id)).toEqual([
      'r4',
      'r1',
    ]);
    expect(queryToolCalls({ decisions: ['denied'] }).rows.map((r) => r.id)).toEqual(['r3']);
    expect(queryToolCalls({ errorState: 'error' }).rows.map((r) => r.id)).toEqual(['r5', 'r3']);
    expect(queryToolCalls({ errorState: 'success' }).rows.map((r) => r.id)).toEqual([
      'r4',
      'r2',
      'r1',
    ]);
    const sinceResult = queryToolCalls({ since: '2026-05-19 11:00:00' });
    expect(sinceResult.rows.map((r) => r.id)).toEqual(['r5', 'r4', 'r3']);
    expect(sinceResult.total).toBe(3);
    expect(
      queryToolCalls({ since: '2026-05-19 10:00:00', until: '2026-05-19 12:00:00' }).rows.map(
        (r) => r.id,
      ),
    ).toEqual(['r4', 'r3', 'r2']);
  });

  it('paginates with limit/offset and reports unfiltered total', () => {
    seed();
    const page1 = queryToolCalls({ limit: 2, offset: 0 });
    expect(page1.rows.map((r) => r.id)).toEqual(['r5', 'r4']);
    expect(page1.total).toBe(5);

    const page2 = queryToolCalls({ limit: 2, offset: 2 });
    expect(page2.rows.map((r) => r.id)).toEqual(['r3', 'r2']);
    expect(page2.total).toBe(5);

    const page3 = queryToolCalls({ limit: 2, offset: 4 });
    expect(page3.rows.map((r) => r.id)).toEqual(['r1']);
  });

  it('truncates oversized payloads and flags inputTruncated/outputTruncated', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const big = 'a'.repeat(TOOL_CALL_AUDIT_PAYLOAD_LIMIT + 100);
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: big },
      output: big,
      decision: 'auto',
      isError: false,
      durationMs: 1,
    });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'small' },
      output: 'small',
      decision: 'auto',
      isError: false,
      durationMs: 1,
    });

    const rows = queryToolCalls({}).rows;
    const oversized = rows.find((r) => r.inputTruncated || r.outputTruncated);
    expect(oversized).toBeDefined();
    expect(oversized?.inputTruncated).toBe(true);
    expect(oversized?.outputTruncated).toBe(true);
    const small = rows.find((r) => !r.inputTruncated && !r.outputTruncated);
    expect(small).toBeDefined();
    expect(small?.input).toEqual({ path: 'small' });
    expect(small?.output).toBe('small');
  });

  it('clamps limit to the [1, 500] range', () => {
    seed();
    expect(queryToolCalls({ limit: 0 }).rows.length).toBe(1);
    expect(queryToolCalls({ limit: 9999 }).rows.length).toBe(5);
    expect(queryToolCalls({ offset: -10 }).rows.length).toBe(5);
  });

  it('handles empty audit log', () => {
    createConversation({});
    const result = queryToolCalls({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.facets.toolNames).toEqual([]);
    expect(result.facets.decisions).toEqual([]);
  });
});

describe('purgeToolCallsOlderThan', () => {
  function seedWithTimestamps(timestamps: string[]): string[] {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const insert = db.prepare(
      `INSERT INTO tool_calls
         (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ids = timestamps.map((ts, i) => `row-${i}`);
    timestamps.forEach((ts, i) => {
      insert.run(ids[i], msg.id, 'read_file', '{"path":"a"}', '"x"', 'auto', 0, 1, ts);
    });
    return ids;
  }

  it('deletes only rows older than the cutoff', () => {
    // now = 2026-05-19 12:00:00 UTC; 7-day cutoff = 2026-05-12 12:00:00
    const now = Date.parse('2026-05-19T12:00:00Z');
    seedWithTimestamps([
      '2026-05-01 00:00:00',
      '2026-05-12 11:00:00',
      '2026-05-12 13:00:00',
      '2026-05-19 11:00:00',
    ]);
    const result = purgeToolCallsOlderThan(7, db, now);
    expect(result.deletedCount).toBe(2);
    const remaining = (
      db.prepare('SELECT id FROM tool_calls ORDER BY id').all() as { id: string }[]
    )
      .map((r) => r.id)
      .sort();
    expect(remaining).toEqual(['row-2', 'row-3']);
  });

  it('returns 0 and is a no-op when nothing is older than the cutoff', () => {
    const now = Date.parse('2026-05-19T12:00:00Z');
    seedWithTimestamps(['2026-05-19 10:00:00', '2026-05-19 11:00:00']);
    expect(purgeToolCallsOlderThan(30, db, now).deletedCount).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as { n: number }).n).toBe(2);
  });

  it('returns 0 for invalid retention values', () => {
    seedWithTimestamps(['2020-01-01 00:00:00']);
    expect(purgeToolCallsOlderThan(0, db).deletedCount).toBe(0);
    expect(purgeToolCallsOlderThan(-5, db).deletedCount).toBe(0);
    expect(purgeToolCallsOlderThan(Number.NaN, db).deletedCount).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as { n: number }).n).toBe(1);
  });
});

describe('clearAllToolCalls', () => {
  it('deletes every row and reports the count', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    for (let i = 0; i < 3; i++) {
      recordToolCall({
        messageId: msg.id,
        toolName: 'read_file',
        input: { i },
        output: 'x',
        decision: 'auto',
        isError: false,
        durationMs: 1,
      });
    }
    expect(clearAllToolCalls(db).deletedCount).toBe(3);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as { n: number }).n).toBe(0);
    expect(clearAllToolCalls(db).deletedCount).toBe(0);
  });
});
