import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AppendMessageRequest,
  Conversation,
  ConversationUsage,
  ConversationUsageByModel,
  StoredMessage,
  TurnStatus,
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
  starred: number;
  project_id: string | null;
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
  cached_input_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
  turn_status: string;
}

const MESSAGE_COLUMNS = `id, conversation_id, role, content, content_blocks_json,
                         provider_id, model_id, input_tokens, output_tokens,
                         cached_input_tokens, cost_usd, created_at, turn_status`;

const VALID_ROLES: ReadonlySet<Role> = new Set(['system', 'user', 'assistant', 'tool']);

/** Title given to a freshly-created conversation until it is (auto-)renamed. */
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

function normalizeTurnStatus(raw: string): TurnStatus {
  return raw === 'streaming' ? 'streaming' : 'final';
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    starred: row.starred === 1,
    projectId: row.project_id,
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
    cachedInputTokens: row.cached_input_tokens ?? null,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    turnStatus: normalizeTurnStatus(row.turn_status),
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
      `SELECT id, title, provider_id, model_id, created_at, updated_at, starred, project_id
       FROM conversations ORDER BY starred DESC, updated_at DESC`,
    )
    .all() as ConversationRow[];
  return rows.map(rowToConversation);
}

export function getConversation(id: string, db: Database.Database = getDb()): Conversation | null {
  const row = db
    .prepare(
      `SELECT id, title, provider_id, model_id, created_at, updated_at, starred, project_id
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
  const title = (input.title?.trim() || DEFAULT_CONVERSATION_TITLE).slice(0, 200);
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

export function setConversationStarred(
  id: string,
  starred: boolean,
  db: Database.Database = getDb(),
): Conversation {
  const result = withSqliteBusyRetry(() =>
    db.prepare(`UPDATE conversations SET starred = ? WHERE id = ?`).run(starred ? 1 : 0, id),
  );
  if (result.changes === 0) throw new Error(`conversation ${id} not found`);
  const conversation = getConversation(id, db);
  if (!conversation) throw new Error(`conversation ${id} not found after star toggle`);
  return conversation;
}

/** Assign a conversation to a project (or unassign with null). */
export function setConversationProject(
  id: string,
  projectId: string | null,
  db: Database.Database = getDb(),
): Conversation {
  if (projectId !== null) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as
      | { id: string }
      | undefined;
    if (!project) throw new Error(`project ${projectId} not found`);
  }
  const result = withSqliteBusyRetry(() =>
    db.prepare(`UPDATE conversations SET project_id = ? WHERE id = ?`).run(projectId, id),
  );
  if (result.changes === 0) throw new Error(`conversation ${id} not found`);
  const conversation = getConversation(id, db);
  if (!conversation) throw new Error(`conversation ${id} not found after project assignment`);
  return conversation;
}

export function deleteConversation(id: string, db: Database.Database = getDb()): void {
  // messages_fts is a standalone FTS5 table — the FK cascade that removes the
  // messages rows does not touch it, so purge it here or deleted conversation
  // text stays recoverable in the index forever.
  const tx = db.transaction(() => {
    try {
      db.prepare('DELETE FROM messages_fts WHERE conversation_id = ?').run(id);
    } catch {
      // best-effort; do not block conversation deletion if FTS is unavailable
    }
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  });
  withSqliteBusyRetry(() => tx());
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
         provider_id, model_id, input_tokens, output_tokens,
         cached_input_tokens, cost_usd, created_at, turn_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      req.cachedInputTokens ?? null,
      req.costUsd ?? null,
      now,
      req.turnStatus ?? 'final',
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
  cached_input_tokens: number | null;
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
              COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM messages
        WHERE conversation_id = ?
          AND (input_tokens IS NOT NULL
            OR output_tokens IS NOT NULL
            OR cached_input_tokens IS NOT NULL
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
    cachedInputTokens: r.cached_input_tokens ?? 0,
    costUsd: r.cost_usd ?? 0,
  }));

  const totalInputTokens = byModel.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = byModel.reduce((s, r) => s + r.outputTokens, 0);
  const totalCachedInputTokens = byModel.reduce((s, r) => s + r.cachedInputTokens, 0);
  const totalCostUsd = byModel.reduce((s, r) => s + r.costUsd, 0);
  const messageCount = byModel.reduce((s, r) => s + r.messageCount, 0);

  return {
    conversationId,
    messageCount,
    totalInputTokens,
    totalOutputTokens,
    totalCachedInputTokens,
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
    cachedInputTokens?: number | null;
    costUsd?: number | null;
    turnStatus?: TurnStatus;
    indexFts?: boolean;
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
           cached_input_tokens = COALESCE(?, cached_input_tokens),
           cost_usd = COALESCE(?, cost_usd),
           turn_status = COALESCE(?, turn_status)
       WHERE id = ?`,
      )
      .run(
        patch.content,
        serializeContentBlocks(patch.contentBlocks),
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.cachedInputTokens ?? null,
        patch.costUsd ?? null,
        patch.turnStatus ?? null,
        id,
      ),
  );
  if (result.changes === 0) throw new Error(`message ${id} not found`);
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id) as
    | MessageRow
    | undefined;
  if (!row) throw new Error(`message ${id} not found after update`);
  // Lane 3 — keep FTS in sync after assistant content is finalised. Throttled
  // crash-restore checkpoints pass indexFts:false so partial writes don't
  // thrash the FTS table; only the terminal write re-indexes.
  if (patch.indexFts !== false) {
    try {
      indexMessageInFts(id, row.conversation_id, patch.content, db);
    } catch {
      // best-effort
    }
  }
  return rowToMessage(row);
}

export function setTurnStatus(
  id: string,
  status: TurnStatus,
  db: Database.Database = getDb(),
): void {
  withSqliteBusyRetry(() =>
    db.prepare('UPDATE messages SET turn_status = ? WHERE id = ?').run(status, id),
  );
}

export function listStreamingAssistantMessages(db: Database.Database = getDb()): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages
       WHERE turn_status = 'streaming' AND role = 'assistant'
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all() as MessageRow[];
  return rows.map(rowToMessage);
}
