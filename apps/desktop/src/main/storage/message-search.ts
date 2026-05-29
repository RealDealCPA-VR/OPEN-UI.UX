import type Database from 'better-sqlite3';
import { getDb } from './db';
import type { ConversationSearchHit } from '../../shared/conversation-search';

interface MessageFtsRow {
  conversation_id: string;
  message_id: string;
  role: string;
  created_at: string;
  conversation_title: string;
  snippet: string;
  score: number;
}

interface SearchMessagesOptions {
  limit?: number;
  conversationId?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

export function searchMessages(
  query: string,
  options: SearchMessagesOptions = {},
  db: Database.Database = getDb(),
): ConversationSearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const ftsQuery = toFtsQuery(trimmed);
  if (!ftsQuery) return [];

  const baseSelect = `
    SELECT
      messages_fts.conversation_id AS conversation_id,
      messages_fts.message_id AS message_id,
      messages.role AS role,
      messages.created_at AS created_at,
      conversations.title AS conversation_title,
      snippet(messages_fts, 2, '[[', ']]', '…', 18) AS snippet,
      bm25(messages_fts) AS score
    FROM messages_fts
    JOIN messages ON messages.id = messages_fts.message_id
    JOIN conversations ON conversations.id = messages_fts.conversation_id
    WHERE messages_fts MATCH ?
  `;

  let sql: string;
  let params: ReadonlyArray<string | number>;
  if (options.conversationId) {
    sql = `${baseSelect} AND messages_fts.conversation_id = ? ORDER BY score ASC LIMIT ?`;
    params = [ftsQuery, options.conversationId, limit];
  } else {
    sql = `${baseSelect} ORDER BY score ASC LIMIT ?`;
    params = [ftsQuery, limit];
  }

  let rows: MessageFtsRow[];
  try {
    rows = db.prepare(sql).all(...params) as MessageFtsRow[];
  } catch {
    return [];
  }

  return rows
    .filter((r) => VALID_ROLES.has(r.role))
    .map((r) => ({
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      messageId: r.message_id,
      role: r.role as ConversationSearchHit['role'],
      createdAt: r.created_at,
      snippet: r.snippet,
      score: r.score,
    }));
}

export function indexMessageInFts(
  messageId: string,
  conversationId: string,
  content: string,
  db: Database.Database = getDb(),
): void {
  db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(messageId);
  if (!content) return;
  db.prepare(
    'INSERT INTO messages_fts (conversation_id, message_id, content) VALUES (?, ?, ?)',
  ).run(conversationId, messageId, content);
}

export function removeMessageFromFts(messageId: string, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(messageId);
}

export function rebuildMessageFts(db: Database.Database = getDb()): void {
  db.exec('DELETE FROM messages_fts');
  const rows = db.prepare('SELECT id, conversation_id, content FROM messages').all() as Array<{
    id: string;
    conversation_id: string;
    content: string;
  }>;
  const insert = db.prepare(
    'INSERT INTO messages_fts (conversation_id, message_id, content) VALUES (?, ?, ?)',
  );
  const tx = db.transaction((items: typeof rows) => {
    for (const r of items) {
      if (r.content) insert.run(r.conversation_id, r.id, r.content);
    }
  });
  tx(rows);
}

function toFtsQuery(raw: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/["*()]/g, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' ');
}
