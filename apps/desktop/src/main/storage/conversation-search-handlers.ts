import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { getDb } from './db';
import { rebuildMessageFts, searchMessages } from './message-search';
import {
  conversationSearchRequestSchema,
  type ConversationSearchResponse,
} from '../../shared/conversation-search';

const DEFAULT_LIMIT = 50;

export function backfillMessageFtsIfEmpty(): void {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number };
    if (row.n > 0) return;
    const msgRow = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    if (msgRow.n === 0) return;
    rebuildMessageFts(db);
    logger.info({ messages: msgRow.n }, 'messages_fts backfilled');
  } catch (err) {
    logger.warn({ err }, 'messages_fts backfill failed');
  }
}

export function registerConversationSearchHandlers(): void {
  backfillMessageFtsIfEmpty();
  registerInvoke(
    'conversations:search',
    conversationSearchRequestSchema,
    (req): ConversationSearchResponse => {
      const limit = req.limit ?? DEFAULT_LIMIT;
      const hits = searchMessages(req.query, { limit, conversationId: req.conversationId });
      return { hits, truncated: hits.length >= limit };
    },
  );
}
