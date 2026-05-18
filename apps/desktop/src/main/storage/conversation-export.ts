import type Database from 'better-sqlite3';
import type {
  Conversation,
  ConversationExportFormat,
  ConversationUsage,
  StoredMessage,
} from '../../shared/conversation';
import { getConversation, getConversationUsage, listMessages } from './conversations';
import { getDb } from './db';

export interface ExportPayload {
  filename: string;
  content: string;
  mimeType: string;
}

export function buildConversationExport(
  id: string,
  format: ConversationExportFormat,
  db: Database.Database = getDb(),
): ExportPayload {
  const conversation = getConversation(id, db);
  if (!conversation) throw new Error(`conversation ${id} not found`);
  const messages = listMessages(id, db);
  const usage = getConversationUsage(id, db);

  const base = sanitizeFilename(conversation.title) || 'conversation';
  if (format === 'json') {
    return {
      filename: `${base}.json`,
      mimeType: 'application/json',
      content: renderJson(conversation, messages, usage),
    };
  }
  return {
    filename: `${base}.md`,
    mimeType: 'text/markdown',
    content: renderMarkdown(conversation, messages, usage),
  };
}

function renderJson(
  conversation: Conversation,
  messages: StoredMessage[],
  usage: ConversationUsage,
): string {
  return `${JSON.stringify(
    {
      schema: 'opencodex.conversation.v1',
      conversation,
      messages,
      usage,
    },
    null,
    2,
  )}\n`;
}

function renderMarkdown(
  conversation: Conversation,
  messages: StoredMessage[],
  usage: ConversationUsage,
): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title}`);
  lines.push('');
  lines.push(`- Created: ${conversation.createdAt}`);
  lines.push(`- Updated: ${conversation.updatedAt}`);
  if (conversation.providerId || conversation.modelId) {
    lines.push(
      `- Model: ${conversation.providerId ?? 'unknown'} / ${conversation.modelId ?? 'unknown'}`,
    );
  }
  lines.push('');

  if (usage.messageCount > 0) {
    lines.push('## Usage');
    lines.push('');
    lines.push(
      `- Total: ${usage.totalInputTokens} in · ${usage.totalOutputTokens} out · $${usage.totalCostUsd.toFixed(4)}`,
    );
    for (const row of usage.byModel) {
      lines.push(
        `  - ${row.providerId ?? 'unknown'} / ${row.modelId ?? 'unknown'}: ${row.inputTokens} in · ${row.outputTokens} out · $${row.costUsd.toFixed(4)} (${row.messageCount} msg${row.messageCount === 1 ? '' : 's'})`,
      );
    }
    lines.push('');
  }

  for (const m of messages) {
    lines.push(`## ${headingForRole(m.role)}`);
    lines.push('');
    lines.push(`*${m.createdAt}*`);
    lines.push('');
    lines.push(m.content.trimEnd());
    lines.push('');
    if (m.role === 'assistant' && (m.inputTokens !== null || m.costUsd !== null)) {
      const usageLine = formatMessageUsage(m);
      if (usageLine) {
        lines.push(`> ${usageLine}`);
        lines.push('');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function headingForRole(role: StoredMessage['role']): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
  }
}

function formatMessageUsage(m: StoredMessage): string {
  const parts: string[] = [];
  if (m.inputTokens !== null) {
    parts.push(`${m.inputTokens} in · ${m.outputTokens ?? 0} out`);
  }
  if (m.costUsd !== null) {
    parts.push(`$${m.costUsd.toFixed(4)}`);
  }
  if (m.providerId || m.modelId) {
    parts.push(`${m.providerId ?? 'unknown'} / ${m.modelId ?? 'unknown'}`);
  }
  return parts.join(' · ');
}

const FILENAME_FORBIDDEN_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

function sanitizeFilename(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || FILENAME_FORBIDDEN_CHARS.has(ch)) {
      out += '_';
    } else if (ch === ' ' || ch === '\t') {
      out += '_';
    } else {
      out += ch;
    }
  }
  return out.replace(/_+/g, '_').replace(/^_+/, '').replace(/_+$/, '').slice(0, 80);
}
