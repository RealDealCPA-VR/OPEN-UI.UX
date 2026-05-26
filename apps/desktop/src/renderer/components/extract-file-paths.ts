import { tokenizeCitations } from './citations';
import type { StoredMessage } from '../../shared/conversation';

/**
 * Scan a list of stored messages for citation-like file:line references
 * (e.g. `apps/desktop/src/foo.ts:42`). Returns unique file paths in
 * first-seen order. `assistantOnly` defaults to true — only scans
 * assistant turns since those contain the agent's findings.
 */
export function extractFilePathsFromMessages(
  messages: readonly StoredMessage[],
  options: { assistantOnly?: boolean; limit?: number } = {},
): string[] {
  const assistantOnly = options.assistantOnly ?? true;
  const limit = options.limit ?? 50;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (assistantOnly && m.role !== 'assistant') continue;
    if (!m.content || m.content.length === 0) continue;
    const tokens = tokenizeCitations(m.content);
    for (const t of tokens) {
      if (t.kind !== 'citation') continue;
      const file = t.file;
      if (!file) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      out.push(file);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Return the last user message's text, or '' if none. */
export function lastUserMessageText(messages: readonly StoredMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && m.content) return m.content;
  }
  return '';
}
