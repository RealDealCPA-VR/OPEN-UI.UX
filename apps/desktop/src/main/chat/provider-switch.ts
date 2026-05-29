import type Database from 'better-sqlite3';
import { BrowserWindow } from 'electron';
import type {
  ProviderSwitchChangedEvent,
  ResendStrategy,
  SwitchProviderResponse,
} from '../../shared/provider-switch';
import { logger } from '../logger';
import { getConversation, listMessages } from '../storage/conversations';
import { getDb } from '../storage/db';

const SUMMARY_USER_MESSAGES_MAX = 6;
const SUMMARY_ASSISTANT_MESSAGES_MAX = 3;
const SUMMARY_CHAR_BUDGET = 1800;

function broadcastSwitch(payload: ProviderSwitchChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chat:provider-switched', payload);
  }
}

interface SwitchProviderArgs {
  conversationId: string;
  providerId: string;
  modelId: string;
  resendStrategy: ResendStrategy;
}

export function buildResendSummary(
  conversationId: string,
  db: Database.Database = getDb(),
): string {
  const messages = listMessages(conversationId, db);
  if (messages.length === 0) return '';

  const userTurns = messages.filter((m) => m.role === 'user').slice(-SUMMARY_USER_MESSAGES_MAX);
  const assistantTurns = messages
    .filter((m) => m.role === 'assistant')
    .slice(-SUMMARY_ASSISTANT_MESSAGES_MAX);

  const lines: string[] = [];
  lines.push('## Conversation context for the new provider');
  lines.push('');
  lines.push('### Recent user turns');
  for (const m of userTurns) lines.push(`- ${truncate(m.content, 280)}`);
  lines.push('');
  lines.push('### Recent assistant turns (summarized)');
  for (const m of assistantTurns) lines.push(`- ${truncate(m.content, 380)}`);

  const joined = lines.join('\n');
  if (joined.length <= SUMMARY_CHAR_BUDGET) return joined;
  return `${joined.slice(0, SUMMARY_CHAR_BUDGET - 1)}…`;
}

function truncate(s: string, max: number): string {
  const single = s.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 1)}…`;
}

export function switchProvider(
  args: SwitchProviderArgs,
  db: Database.Database = getDb(),
): SwitchProviderResponse {
  const existing = getConversation(args.conversationId, db);
  if (!existing) throw new Error(`conversation ${args.conversationId} not found`);

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE conversations
       SET provider_id = ?, model_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(args.providerId, args.modelId, now, args.conversationId);
  if (result.changes === 0) {
    throw new Error(`conversation ${args.conversationId} not updated`);
  }

  const summary =
    args.resendStrategy === 'summary-only' ? buildResendSummary(args.conversationId, db) : null;

  logger.info(
    {
      conversationId: args.conversationId,
      providerId: args.providerId,
      modelId: args.modelId,
      resendStrategy: args.resendStrategy,
      summaryChars: summary?.length ?? 0,
    },
    'provider switched for conversation',
  );

  broadcastSwitch({
    conversationId: args.conversationId,
    providerId: args.providerId,
    modelId: args.modelId,
    resendStrategy: args.resendStrategy,
  });

  return {
    conversationId: args.conversationId,
    providerId: args.providerId,
    modelId: args.modelId,
    resendStrategy: args.resendStrategy,
    summary,
  };
}
