import type { LLMProvider, Message } from '@opencodex/core';
import { logger } from '../logger';
import {
  DEFAULT_CONVERSATION_TITLE,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
} from '../storage/conversations';
import { broadcastConversationsChanged } from './conversations-events';

const TITLE_TIMEOUT_MS = 20_000;
const TITLE_MAX_LEN = 60;

/**
 * Clean a raw model response into a short conversation title: first line only,
 * stripped of surrounding quotes/markdown, collapsed whitespace, no trailing
 * punctuation, length-capped.
 */
export function sanitizeTitle(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine
    .trim()
    .replace(/^["'`*#\s]+/, '')
    .replace(/["'`*\s]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '')
    .slice(0, TITLE_MAX_LEN)
    .trim();
}

/** Build the (tool-free) prompt used to name a conversation. */
export function buildTitleMessages(firstUser: string, assistantText: string): Message[] {
  const user = firstUser.slice(0, 800);
  const assistant = assistantText.slice(0, 400);
  return [
    {
      role: 'user',
      content:
        'Write a short, specific title (2–5 words, Title Case, no quotes, no trailing ' +
        'punctuation) for the conversation below. Reply with ONLY the title.\n\n' +
        `User: ${user}\n\nAssistant: ${assistant}`,
    },
  ];
}

/**
 * Ask the same provider/model used for the turn for a concise title. Returns
 * null on any failure (timeout, provider error, empty output) — callers should
 * leave the default title in place.
 */
export async function generateTitle(
  provider: LLMProvider,
  modelId: string,
  firstUser: string,
  assistantText: string,
): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TITLE_TIMEOUT_MS);
  let text = '';
  try {
    const iter = provider.chat({
      model: modelId,
      messages: buildTitleMessages(firstUser, assistantText),
      maxTokens: 24,
      temperature: 0.2,
      signal: ac.signal,
    });
    for await (const event of iter) {
      if (event.type === 'text_delta') text += event.delta;
      else if (event.type === 'error') return null;
      else if (event.type === 'done') break;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  const title = sanitizeTitle(text);
  return title.length > 0 ? title : null;
}

/**
 * Auto-title a conversation that is still on its default title, using the first
 * user message + the just-completed assistant reply. Best-effort and silent on
 * failure; broadcasts the refreshed list so sidebars update immediately.
 */
export async function autoTitleConversation(opts: {
  conversationId: string;
  provider: LLMProvider;
  modelId: string;
  assistantText: string;
}): Promise<void> {
  try {
    const conv = getConversation(opts.conversationId);
    if (!conv || conv.title !== DEFAULT_CONVERSATION_TITLE) return;

    const firstUser = listMessages(opts.conversationId)
      .find((m) => m.role === 'user')
      ?.content.trim();
    if (!firstUser || firstUser.length === 0) return;

    const title = await generateTitle(opts.provider, opts.modelId, firstUser, opts.assistantText);
    if (!title) return;

    // The user may have renamed it while the title call was in flight — never
    // clobber an explicit choice.
    const current = getConversation(opts.conversationId);
    if (!current || current.title !== DEFAULT_CONVERSATION_TITLE) return;

    renameConversation(opts.conversationId, title);
    broadcastConversationsChanged(listConversations());
  } catch (err) {
    logger.warn({ err, conversationId: opts.conversationId }, 'auto-title failed');
  }
}
