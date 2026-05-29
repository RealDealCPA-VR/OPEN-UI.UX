import { randomUUID } from 'node:crypto';
import type { StoredMessage } from '../../shared/conversation';
import type { PairChangeKind, PairSuggestion, PairSuggestionEvent } from '../../shared/pair';

const CITATION_RE = /(\b[\w./\\-]+\.[\w]{1,8}):(\d+)(?:-(\d+)|:(\d+))?\b/g;
const BARE_PATH_RE = /(\b[\w./\\-]+\.[\w]{1,8})\b/g;

const RECENT_MESSAGE_WINDOW = 20;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function collectReferencedPaths(messages: readonly StoredMessage[]): Set<string> {
  const recent = messages.slice(-RECENT_MESSAGE_WINDOW);
  const out = new Set<string>();
  for (const msg of recent) {
    if (!msg.content) continue;
    for (const m of msg.content.matchAll(CITATION_RE)) {
      const file = m[1];
      if (file) out.add(normalizePath(file));
    }
    for (const m of msg.content.matchAll(BARE_PATH_RE)) {
      const file = m[1];
      if (file && file.includes('.')) out.add(normalizePath(file));
    }
  }
  return out;
}

interface SuggestionBucket {
  conversationId: string;
  suggestions: Map<string, PairSuggestion>;
}

export interface FileSuggestionsContext {
  /** Resolves the active conversation id at suggestion time, or null when none. */
  getActiveConversationId: () => string | null;
  /** Loads stored messages for a conversation; ordered chronologically. */
  getMessagesForConversation: (conversationId: string) => readonly StoredMessage[];
  /** Optional emitter — receives every new suggestion. */
  onSuggestion?: (event: PairSuggestionEvent) => void;
}

export interface WatcherBatchLike {
  added: readonly string[];
  changed: readonly string[];
  removed: readonly string[];
}

export class FileSuggestionsEngine {
  private readonly buckets = new Map<string, SuggestionBucket>();
  private ctx: FileSuggestionsContext;

  constructor(ctx: FileSuggestionsContext) {
    this.ctx = ctx;
  }

  /**
   * Drop all queued suggestions and start over.
   * Used when the active workspace changes or the user signs out of a conversation.
   */
  reset(): void {
    this.buckets.clear();
  }

  /** Returns the queued (non-dismissed) suggestions for a conversation. */
  listForConversation(conversationId: string): PairSuggestion[] {
    const bucket = this.buckets.get(conversationId);
    if (!bucket) return [];
    return [...bucket.suggestions.values()];
  }

  /** Returns a suggestion by id across all buckets, or undefined. */
  findSuggestion(id: string): PairSuggestion | undefined {
    for (const bucket of this.buckets.values()) {
      const found = bucket.suggestions.get(id);
      if (found) return found;
    }
    return undefined;
  }

  /** Removes a suggestion by id. Returns true when something was removed. */
  dismiss(id: string): boolean {
    for (const bucket of this.buckets.values()) {
      if (bucket.suggestions.delete(id)) return true;
    }
    return false;
  }

  /**
   * Translate a watcher batch into suggestions. A path becomes a suggestion only
   * when the active conversation's last 20 messages reference it.
   */
  ingestBatch(batch: WatcherBatchLike): readonly PairSuggestion[] {
    const conversationId = this.ctx.getActiveConversationId();
    if (!conversationId) return [];
    const messages = this.ctx.getMessagesForConversation(conversationId);
    const referenced = collectReferencedPaths(messages);
    if (referenced.size === 0) return [];

    const created: PairSuggestion[] = [];
    const bucket = this.getOrCreateBucket(conversationId);

    const consider = (path: string, kind: PairChangeKind): void => {
      const norm = normalizePath(path);
      if (!referenced.has(norm) && !hasMatchingSuffix(referenced, norm)) return;
      const suggestion: PairSuggestion = {
        id: randomUUID(),
        conversationId,
        filePath: path,
        changeKind: kind,
        createdAt: new Date().toISOString(),
      };
      bucket.suggestions.set(suggestion.id, suggestion);
      created.push(suggestion);
      this.ctx.onSuggestion?.({ suggestion });
    };

    for (const p of batch.added) consider(p, 'create');
    for (const p of batch.changed) consider(p, 'edit');
    for (const p of batch.removed) consider(p, 'delete');

    return created;
  }

  private getOrCreateBucket(conversationId: string): SuggestionBucket {
    const existing = this.buckets.get(conversationId);
    if (existing) return existing;
    const bucket: SuggestionBucket = {
      conversationId,
      suggestions: new Map(),
    };
    this.buckets.set(conversationId, bucket);
    return bucket;
  }
}

function hasMatchingSuffix(referenced: Set<string>, candidate: string): boolean {
  for (const ref of referenced) {
    if (candidate.endsWith('/' + ref) || ref.endsWith('/' + candidate)) return true;
  }
  return false;
}

let activeEngine: FileSuggestionsEngine | null = null;

export function setFileSuggestionsEngine(engine: FileSuggestionsEngine | null): void {
  activeEngine = engine;
}

export function getFileSuggestionsEngine(): FileSuggestionsEngine | null {
  return activeEngine;
}
