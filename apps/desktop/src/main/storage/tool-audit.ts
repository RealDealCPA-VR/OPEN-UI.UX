import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db';

export type ToolCallAuditDecision =
  | 'auto'
  | 'prompt-allowed'
  | 'prompt-allowed-session'
  | 'prompt-allowed-always'
  | 'denied';

export interface RecordToolCallInput {
  messageId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  decision: ToolCallAuditDecision;
  isError: boolean;
  durationMs: number | null;
}

export interface ToolCallAuditRow {
  id: string;
  messageId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  decision: ToolCallAuditDecision;
  isError: boolean;
  durationMs: number | null;
  createdAt: string;
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
}

const COLUMNS = `id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms, created_at`;

export function recordToolCall(
  input: RecordToolCallInput,
  db: Database.Database = getDb(),
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tool_calls
       (id, message_id, tool_name, input_json, output_json, decision, is_error, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.messageId,
    input.toolName,
    safeStringify(input.input),
    input.output === undefined ? null : safeStringify(input.output),
    input.decision,
    input.isError ? 1 : 0,
    input.durationMs,
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
  return rows.map(rowToAudit);
}

function rowToAudit(row: RawRow): ToolCallAuditRow {
  return {
    id: row.id,
    messageId: row.message_id,
    toolName: row.tool_name,
    input: parseJsonOrRaw(row.input_json),
    output: row.output_json === null ? null : parseJsonOrRaw(row.output_json),
    decision: row.decision as ToolCallAuditDecision,
    isError: row.is_error !== 0,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
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
