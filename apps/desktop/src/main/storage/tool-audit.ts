import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  TOOL_CALL_AUDIT_PAYLOAD_LIMIT,
  type ToolCallAuditDecision,
  type ToolCallAuditQuery,
  type ToolCallAuditQueryResult,
  type ToolCallAuditQueryRow,
  type ToolCallAuditRow,
  type ToolCallAuditTriggerSource,
} from '../../shared/tool-audit';
import { withSqliteBusyRetry } from '../util/sqlite-retry';
import { getDb } from './db';

export type { ToolCallAuditDecision, ToolCallAuditRow };

export interface RecordToolCallInput {
  messageId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  decision: ToolCallAuditDecision;
  isError: boolean;
  durationMs: number | null;
  triggerSource?: ToolCallAuditTriggerSource;
}

interface RawRow {
  id: string;
  message_id: string;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  decision: string;
  is_error: number;
  duration_ms: number | null;
  created_at: string;
  trigger_source: string;
}

interface RawQueryRow extends RawRow {
  input_json_len: number;
  output_json_len: number | null;
  conversation_id: string;
  conversation_title: string;
}

const COLUMNS = `id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at, trigger_source`;

const QUERY_LIMIT_DEFAULT = 100;
const QUERY_LIMIT_MAX = 500;

export function recordToolCall(
  input: RecordToolCallInput,
  db: Database.Database = getDb(),
): string {
  const id = randomUUID();
  withSqliteBusyRetry(() =>
    db
      .prepare(
        `INSERT INTO tool_calls
       (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.messageId,
        input.toolName,
        safeStringify(input.input),
        input.output === undefined ? null : safeStringify(input.output),
        input.decision,
        input.isError ? 1 : 0,
        input.durationMs,
        input.triggerSource ?? 'user',
      ),
  );
  return id;
}

export function listToolCallsForMessage(
  messageId: string,
  db: Database.Database = getDb(),
): ToolCallAuditRow[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM tool_calls WHERE message_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(messageId) as RawRow[];
  return rows.map((r) => rowToAudit(r, r.input_json, r.output_json));
}

export function queryToolCalls(
  query: ToolCallAuditQuery,
  db: Database.Database = getDb(),
): ToolCallAuditQueryResult {
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (query.toolNames && query.toolNames.length > 0) {
    filters.push(`tc.tool_name IN (${query.toolNames.map(() => '?').join(', ')})`);
    params.push(...query.toolNames);
  }
  if (query.decisions && query.decisions.length > 0) {
    filters.push(`tc.decision IN (${query.decisions.map(() => '?').join(', ')})`);
    params.push(...query.decisions);
  }
  if (query.errorState === 'error') filters.push(`tc.is_error = 1`);
  else if (query.errorState === 'success') filters.push(`tc.is_error = 0`);
  if (query.since) {
    filters.push(`tc.created_at >= ?`);
    params.push(query.since);
  }
  if (query.until) {
    filters.push(`tc.created_at <= ?`);
    params.push(query.until);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(query.limit ?? QUERY_LIMIT_DEFAULT, QUERY_LIMIT_MAX));
  const offset = Math.max(0, query.offset ?? 0);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM tool_calls tc ${whereClause}`)
    .get(...params) as { n: number };

  const rows = db
    .prepare(
      `SELECT
         tc.id, tc.message_id, tc.tool_name,
         SUBSTR(tc.input_json, 1, ${TOOL_CALL_AUDIT_PAYLOAD_LIMIT}) AS input_json,
         LENGTH(tc.input_json) AS input_json_len,
         SUBSTR(tc.output_json, 1, ${TOOL_CALL_AUDIT_PAYLOAD_LIMIT}) AS output_json,
         LENGTH(tc.output_json) AS output_json_len,
         tc.decision, tc.is_error, tc.duration_ms, tc.created_at, tc.trigger_source,
         m.conversation_id AS conversation_id,
         c.title AS conversation_title
       FROM tool_calls tc
       JOIN messages m ON m.id = tc.message_id
       JOIN conversations c ON c.id = m.conversation_id
       ${whereClause}
       ORDER BY tc.created_at DESC, tc.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as RawQueryRow[];

  const toolNames = db
    .prepare(`SELECT DISTINCT tool_name FROM tool_calls ORDER BY tool_name ASC`)
    .all() as { tool_name: string }[];

  const decisions = db
    .prepare(`SELECT DISTINCT decision FROM tool_calls ORDER BY decision ASC`)
    .all() as { decision: string }[];

  const mapped: ToolCallAuditQueryRow[] = rows.map((r) => ({
    ...rowToAudit(r, r.input_json, r.output_json, r.input_json_len, r.output_json_len),
    conversationId: r.conversation_id,
    conversationTitle: r.conversation_title,
  }));

  return {
    rows: mapped,
    total: totalRow.n,
    facets: {
      toolNames: toolNames.map((t) => t.tool_name),
      decisions: decisions.map((d) => d.decision as ToolCallAuditDecision),
    },
  };
}

export function purgeToolCallsOlderThan(
  retentionDays: number,
  db: Database.Database = getDb(),
  nowMs: number = Date.now(),
): { deletedCount: number } {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return { deletedCount: 0 };
  }
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 19).replace('T', ' ');
  const result = db.prepare('DELETE FROM tool_calls WHERE created_at < ?').run(cutoff);
  return { deletedCount: result.changes };
}

export function clearAllToolCalls(db: Database.Database = getDb()): { deletedCount: number } {
  const result = db.prepare('DELETE FROM tool_calls').run();
  return { deletedCount: result.changes };
}

function rowToAudit(
  row: RawRow,
  inputJson: string,
  outputJson: string | null,
  inputJsonLen?: number,
  outputJsonLen?: number | null,
): ToolCallAuditRow {
  const inputLen = inputJsonLen ?? inputJson.length;
  const outputLen = outputJsonLen ?? (outputJson === null ? null : outputJson.length);
  return {
    id: row.id,
    messageId: row.message_id,
    toolName: row.tool_name,
    input: parseJsonOrRaw(inputJson),
    output: outputJson === null ? null : parseJsonOrRaw(outputJson),
    decision: row.decision as ToolCallAuditDecision,
    isError: row.is_error !== 0,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    inputTruncated: inputLen > TOOL_CALL_AUDIT_PAYLOAD_LIMIT,
    outputTruncated: outputLen !== null && outputLen > TOOL_CALL_AUDIT_PAYLOAD_LIMIT,
    triggerSource: (row.trigger_source as ToolCallAuditTriggerSource) ?? 'user',
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(String(value));
  }
}

function parseJsonOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
