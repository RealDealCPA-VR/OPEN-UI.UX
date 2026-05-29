import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AppendMessageRequest,
  Conversation,
  ConversationUsage,
  ConversationUsageByModel,
  StoredMessage,
} from '../../shared/conversation';
import type { ContentBlock, Role } from '@opencodex/core';
import { withSqliteBusyRetry } from '../util/sqlite-retry';
import { getDb } from './db';
import { indexMessageInFts } from './message-search';

interface ConversationRow {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  content_blocks_json: string | null;
  provider_id: string | null;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

const MESSAGE_COLUMNS = `id, conversation_id, role, content, content_blocks_json,
                         provider_id, model_id, input_tokens, output_tokens, cost_usd, created_at`;

const VALID_ROLES: ReadonlySet<Role> = new Set(['system', 'user', 'assistant', 'tool']);

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): StoredMessage {
  if (!VALID_ROLES.has(row.role as Role)) {
    throw new Error(`invalid role "${row.role}" in messages table`);
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Role,
    content: row.content,
    contentBlocks: parseContentBlocks(row.content_blocks_json),
    providerId: row.provider_id,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

function parseContentBlocks(raw: string | null): ContentBlock[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ContentBlock[];
    return null;
  } catch {
    return null;
  }
}

function serializeContentBlocks(blocks: ContentBlock[] | null | undefined): string | null {
  if (!blocks) return null;
  return JSON.stringify(blocks);
}

export interface CreateConversationInput {
  title?: string;
  providerId?: string | null;
  modelId?: string | null;
}

export function listConversations(db: Database.Database = getDb()): Conversation[] {
  const rows = db
    .prepare(
      `SELECT id, title, provider_id, model_id, created_at, updated_at
       FROM conversations ORDER BY updated_at DESC`,
    )
    .all() as ConversationRow[];
  return rows.map(rowToConversation);
}

export function getConversation(id: string, db: Database.Database = getDb()): Conversation | null {
  const row = db
    .prepare(
      `SELECT id, title, provider_id, model_id, created_at, updated_at
       FROM conversations WHERE id = ?`,
    )
    .get(id) as ConversationRow | undefined;
  return row ? rowToConversation(row) : null;
}

export function createConversation(
  input: CreateConversationInput,
  db: Database.Database = getDb(),
): Conversation {
  const id = randomUUID();
  const title = (input.title?.trim() || 'New conversation').slice(0, 200);
  const now = new Date().toISOString();
  withSqliteBusyRetry(() =>
    db
      .prepare(
        `INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, title, input.providerId ?? null, input.modelId ?? null, now, now),
  );
  const conversation = getConversation(id, db);
  if (!conversation) throw new Error('failed to create conversation');
  return conversation;
}

export function renameConversation(
  id: string,
  title: string,
  db: Database.Database = getDb(),
): Conversation {
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) throw new Error('title cannot be empty');
  const now = new Date().toISOString();
  const result = withSqliteBusyRetry(() =>
    db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(trimmed, now, id),
  );
  if (result.changes === 0) throw new Error(`conversation ${id} not found`);
  const conversation = getConversation(id, db);
  if (!conversation) throw new Error(`conversation ${id} not found after rename`);
  return conversation;
}

export function deleteConversation(id: string, db: Database.Database = getDb()): void {
  withSqliteBusyRetry(() => db.prepare('DELETE FROM conversations WHERE id = ?').run(id));
}

export function listMessages(
  conversationId: string,
  db: Database.Database = getDb(),
): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(rowToMessage);
}

export function appendMessage(
  req: AppendMessageRequest,
  db: Database.Database = getDb(),
): StoredMessage {
  const id = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const existing = getConversation(req.conversationId, db);
    if (!existing) throw new Error(`conversation ${req.conversationId} not found`);
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, content_blocks_json,
         provider_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.conversationId,
      req.role,
      req.content,
      serializeContentBlocks(req.contentBlocks),
      req.providerId ?? null,
      req.modelId ?? null,
      req.inputTokens ?? null,
      req.outputTokens ?? null,
      req.costUsd ?? null,
      now,
    );
    try {
      indexMessageInFts(id, req.conversationId, req.content, db);
    } catch {
      // best-effort; do not block the message insert if FTS is unavailable
    }
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, req.conversationId);
  });
  withSqliteBusyRetry(() => tx());
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id) as
    | MessageRow
    | undefined;
  if (!row) throw new Error('failed to read back appended message');
  return rowToMessage(row);
}

interface UsageRow {
  provider_id: string | null;
  model_id: string | null;
  message_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export function getConversationUsage(
  conversationId: string,
  db: Database.Database = getDb(),
): ConversationUsage {
  const rows = db
    .prepare(
      `SELECT provider_id, model_id,
              COUNT(*) AS message_count,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM messages
        WHERE conversation_id = ?
          AND (input_tokens IS NOT NULL
            OR output_tokens IS NOT NULL
            OR cost_usd IS NOT NULL)
        GROUP BY provider_id, model_id
        ORDER BY provider_id ASC, model_id ASC`,
    )
    .all(conversationId) as UsageRow[];

  const byModel: ConversationUsageByModel[] = rows.map((r) => ({
    providerId: r.provider_id,
    modelId: r.model_id,
    messageCount: r.message_count,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    costUsd: r.cost_usd ?? 0,
  }));

  const totalInputTokens = byModel.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = byModel.reduce((s, r) => s + r.outputTokens, 0);
  const totalCostUsd = byModel.reduce((s, r) => s + r.costUsd, 0);
  const messageCount = byModel.reduce((s, r) => s + r.messageCount, 0);

  return {
    conversationId,
    messageCount,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    byModel,
  };
}

export function updateAssistantMessage(
  id: string,
  patch: {
    content: string;
    contentBlocks?: ContentBlock[] | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
  },
  db: Database.Database = getDb(),
): StoredMessage {
  const result = withSqliteBusyRetry(() =>
    db
      .prepare(
        `UPDATE messages
       SET content = ?,
           content_blocks_json = ?,
           input_tokens = COALESCE(?, input_tokens),
           output_tokens = COALESCE(?, output_tokens),
           cost_usd = COALESCE(?, cost_usd)
       WHERE id = ?`,
      )
      .run(
        patch.content,
        serializeContentBlocks(patch.contentBlocks),
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.costUsd ?? null,
        id,
      ),
  );
  if (result.changes === 0) throw new Error(`message ${id} not found`);
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id) as
    | MessageRow
    | undefined;
  if (!row) throw new Error(`message ${id} not found after update`);
  // Lane 3 — keep FTS in sync after assistant content is finalised.
  try {
    indexMessageInFts(id, row.conversation_id, patch.content, db);
  } catch {
    // best-effort
  }
  return rowToMessage(row);
}
