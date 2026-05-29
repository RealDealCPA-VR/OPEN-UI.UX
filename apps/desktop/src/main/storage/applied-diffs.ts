import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AppliedDiff,
  ListAppliedDiffsRequest,
  ListAppliedDiffsResponse,
} from '../../shared/replay';
import { getDb } from './db';

export interface RecordAppliedDiffInput {
  conversationId: string;
  messageId: string;
  toolCallId?: string | null;
  filePath: string;
  diff: string;
  promptSnapshot?: string | null;
  ragCitations?: unknown;
  routingDecision?: unknown;
  providerId?: string | null;
  modelId?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  costUsd?: number | null;
  seed?: number | null;
}

interface RawRow {
  id: string;
  conversation_id: string;
  message_id: string;
  tool_call_id: string | null;
  file_path: string;
  diff: string;
  prompt_snapshot: string | null;
  rag_citations_json: string | null;
  routing_decision_json: string | null;
  provider_id: string | null;
  model_id: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  seed: number | null;
  applied_at: string;
}

const COLUMNS = `id, conversation_id, message_id, tool_call_id, file_path, diff,
                 prompt_snapshot, rag_citations_json, routing_decision_json,
                 provider_id, model_id, tokens_input, tokens_output, cost_usd, seed, applied_at`;

function rowToAppliedDiff(row: RawRow): AppliedDiff {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    toolCallId: row.tool_call_id,
    filePath: row.file_path,
    diff: row.diff,
    promptSnapshot: row.prompt_snapshot,
    ragCitationsJson: row.rag_citations_json,
    routingDecisionJson: row.routing_decision_json,
    providerId: row.provider_id,
    modelId: row.model_id,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    costUsd: row.cost_usd,
    seed: row.seed,
    appliedAt: row.applied_at,
  };
}

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function recordAppliedDiff(
  input: RecordAppliedDiffInput,
  db: Database.Database = getDb(),
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO applied_diffs
       (id, conversation_id, message_id, tool_call_id, file_path, diff,
        prompt_snapshot, rag_citations_json, routing_decision_json,
        provider_id, model_id, tokens_input, tokens_output, cost_usd, seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.conversationId,
    input.messageId,
    input.toolCallId ?? null,
    input.filePath,
    input.diff,
    input.promptSnapshot ?? null,
    safeStringify(input.ragCitations),
    safeStringify(input.routingDecision),
    input.providerId ?? null,
    input.modelId ?? null,
    input.tokensInput ?? null,
    input.tokensOutput ?? null,
    input.costUsd ?? null,
    input.seed ?? null,
  );
  return id;
}

export function getAppliedDiff(id: string, db: Database.Database = getDb()): AppliedDiff | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM applied_diffs WHERE id = ?`).get(id) as
    | RawRow
    | undefined;
  return row ? rowToAppliedDiff(row) : null;
}

export function listAppliedDiffs(
  query: ListAppliedDiffsRequest,
  db: Database.Database = getDb(),
): ListAppliedDiffsResponse {
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (query.conversationId) {
    filters.push('conversation_id = ?');
    params.push(query.conversationId);
  }
  if (query.filePath) {
    filters.push('file_path = ?');
    params.push(query.filePath);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM applied_diffs ${where}`)
    .get(...params) as { n: number };

  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM applied_diffs ${where}
       ORDER BY applied_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as RawRow[];

  return {
    rows: rows.map(rowToAppliedDiff),
    total: totalRow.n,
  };
}

export function listAppliedDiffsForConversation(
  conversationId: string,
  db: Database.Database = getDb(),
): AppliedDiff[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM applied_diffs WHERE conversation_id = ?
       ORDER BY applied_at ASC, rowid ASC`,
    )
    .all(conversationId) as RawRow[];
  return rows.map(rowToAppliedDiff);
}

export function deleteAppliedDiff(id: string, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM applied_diffs WHERE id = ?').run(id);
}
