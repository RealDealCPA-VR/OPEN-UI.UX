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

  describe('filePath + runnerIds filters', () => {
    function seedRunnerRows(): void {
      const conv = createConversation({ title: 'Mixed' });
      const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
      const insert = db.prepare(
        `INSERT INTO tool_calls
           (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at, trigger_source, runner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        'oc-null',
        msg.id,
        'read_file',
        '{"path":"src/main/index.ts"}',
        '"ok"',
        'auto',
        0,
        1,
        '2026-05-19 09:00:00',
        'user',
        null,
      );
      insert.run(
        'oc-internal',
        msg.id,
        'read_file',
        '{"path":"docs/README.md"}',
        '"ok"',
        'auto',
        0,
        1,
        '2026-05-19 09:30:00',
        'user',
        'internal',
      );
      insert.run(
        'r-claude',
        msg.id,
        'write_file',
        '{"path":"src/main/index.ts"}',
        '"ok"',
        'auto',
        0,
        1,
        '2026-05-19 10:00:00',
        'user',
        'runner-claude',
      );
      insert.run(
        'r-codex',
        msg.id,
        'web_fetch',
        '{"url":"https://example.com/file.txt"}',
        '"ok"',
        'auto',
        0,
        1,
        '2026-05-19 11:00:00',
        'user',
        'runner-codex',
      );
    }

    it('filters by filePath substring match against input_json', () => {
      seedRunnerRows();
      const result = queryToolCalls({ filePath: 'src/main/index.ts' });
      const ids = result.rows.map((r) => r.id).sort();
      expect(ids).toEqual(['oc-null', 'r-claude']);
      expect(result.total).toBe(2);
    });

    it('escapes LIKE wildcards in filePath so % and _ are literal', () => {
      const conv = createConversation({});
      const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
      const insert = db.prepare(
        `INSERT INTO tool_calls (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at, trigger_source, runner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        'a',
        msg.id,
        'read_file',
        '{"path":"a_b"}',
        '"x"',
        'auto',
        0,
        1,
        '2026-05-19 09:00:00',
        'user',
        null,
      );
      insert.run(
        'b',
        msg.id,
        'read_file',
        '{"path":"aXb"}',
        '"x"',
        'auto',
        0,
        1,
        '2026-05-19 09:00:01',
        'user',
        null,
      );
      const result = queryToolCalls({ filePath: 'a_b' });
      expect(result.rows.map((r) => r.id)).toEqual(['a']);
    });

    it('filters by runnerIds (external runner only)', () => {
      seedRunnerRows();
      const result = queryToolCalls({ runnerIds: ['runner-claude'] });
      expect(result.rows.map((r) => r.id)).toEqual(['r-claude']);
      expect(result.total).toBe(1);
    });

    it('filters by runnerIds with __opencodex__ sentinel matching null/empty/internal', () => {
      seedRunnerRows();
      const result = queryToolCalls({ runnerIds: ['__opencodex__'] });
      const ids = result.rows.map((r) => r.id).sort();
      expect(ids).toEqual(['oc-internal', 'oc-null']);
      expect(result.total).toBe(2);
    });

    it('combines __opencodex__ sentinel with explicit runner ids', () => {
      seedRunnerRows();
      const result = queryToolCalls({
        runnerIds: ['__opencodex__', 'runner-codex'],
      });
      const ids = result.rows.map((r) => r.id).sort();
      expect(ids).toEqual(['oc-internal', 'oc-null', 'r-codex']);
      expect(result.total).toBe(3);
    });

    it('filters by triggerSource', () => {
      const conv = createConversation({});
      const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
      const insert = db.prepare(
        `INSERT INTO tool_calls (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at, trigger_source, runner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        'u',
        msg.id,
        'read_file',
        '{"path":"a"}',
        '"x"',
        'auto',
        0,
        1,
        '2026-05-19 09:00:00',
        'user',
        null,
      );
      insert.run(
        's',
        msg.id,
        'read_file',
        '{"path":"b"}',
        '"x"',
        'auto',
        0,
        1,
        '2026-05-19 09:00:01',
        'scheduled',
        null,
      );
      expect(queryToolCalls({ triggerSource: 'user' }).rows.map((r) => r.id)).toEqual(['u']);
      expect(queryToolCalls({ triggerSource: 'scheduled' }).rows.map((r) => r.id)).toEqual(['s']);
    });

    it('composes filePath + runnerIds together', () => {
      seedRunnerRows();
      const result = queryToolCalls({
        filePath: 'src/main/index.ts',
        runnerIds: ['__opencodex__'],
      });
      expect(result.rows.map((r) => r.id)).toEqual(['oc-null']);
      expect(result.total).toBe(1);
    });
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

describe('routingDecision audit field', () => {
  it('round-trips the routing decision through the tool_calls row', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a.ts' },
      output: 'ok',
      decision: 'auto',
      isError: false,
      durationMs: 5,
      routingDecision: {
        matched: 'tool_call',
        ruleId: 'rule-tools',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        usedFallback: false,
      },
    });

    const rows = listToolCallsForMessage(msg.id);
    expect(rows[0]?.routingDecision).toEqual({
      matched: 'tool_call',
      ruleId: 'rule-tools',
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
      usedFallback: false,
    });
  });

  it('persists null when no routing decision was supplied', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'a.ts' },
      output: 'ok',
      decision: 'auto',
      isError: false,
      durationMs: 5,
    });

    const rows = listToolCallsForMessage(msg.id);
    expect(rows[0]?.routingDecision).toBeNull();
  });

  it('preserves degradedReason when the provider was missing', () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'edit_file',
      input: { path: 'a.ts' },
      output: 'ok',
      decision: 'prompt-allowed',
      isError: false,
      durationMs: 8,
      routingDecision: {
        matched: 'reasoning',
        ruleId: 'rule-reasoning',
        providerId: 'openai',
        modelId: 'gpt-4o',
        usedFallback: true,
        degradedReason: 'provider_missing',
      },
    });

    const [row] = listToolCallsForMessage(msg.id);
    expect(row?.routingDecision?.degradedReason).toBe('provider_missing');
    expect(row?.routingDecision?.usedFallback).toBe(true);
  });
});
