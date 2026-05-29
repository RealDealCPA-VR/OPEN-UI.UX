import { BrowserWindow } from 'electron';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { appendMessage, listMessages } from '../storage/conversations';
import { getSettings } from '../storage/settings';
import {
  pairApplyAsContextRequestSchema,
  pairDismissSuggestionRequestSchema,
  pairGetActiveSuggestionsRequestSchema,
  pairSetActiveConversationRequestSchema,
  type PairSuggestionEvent,
} from '../../shared/pair';
import {
  FileSuggestionsEngine,
  getFileSuggestionsEngine,
  setFileSuggestionsEngine,
  type WatcherBatchLike,
} from './file-suggestions';

let activeConversationId: string | null = null;

function broadcastSuggestion(event: PairSuggestionEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('pair:suggestion', event);
  }
}

export function initPairSuggestions(): void {
  if (getFileSuggestionsEngine()) return;
  const engine = new FileSuggestionsEngine({
    getActiveConversationId: () => activeConversationId,
    getMessagesForConversation: (id) => {
      try {
        return listMessages(id);
      } catch (err) {
        logger.warn({ err, conversationId: id }, 'pair: failed to read messages');
        return [];
      }
    },
    onSuggestion: broadcastSuggestion,
  });
  setFileSuggestionsEngine(engine);
}

/**
 * Hook called by the workspace watcher when a debounced batch fires.
 * Safe to call before initPairSuggestions(); becomes a no-op.
 */
export function notifyPairWatcherBatch(batch: WatcherBatchLike): void {
  const engine = getFileSuggestionsEngine();
  if (!engine) return;
  engine.ingestBatch(batch);
}

export function registerPairHandlers(): void {
  initPairSuggestions();

  registerInvoke('pair:get-active-suggestions', pairGetActiveSuggestionsRequestSchema, (req) => {
    const engine = getFileSuggestionsEngine();
    const conversationId = req.conversationId ?? activeConversationId;
    if (!engine || !conversationId) return { suggestions: [] };
    return { suggestions: engine.listForConversation(conversationId) };
  });

  registerInvoke('pair:dismiss-suggestion', pairDismissSuggestionRequestSchema, (req) => {
    const engine = getFileSuggestionsEngine();
    if (!engine) return { ok: false };
    return { ok: engine.dismiss(req.suggestionId) };
  });

  registerInvoke('pair:apply-as-context', pairApplyAsContextRequestSchema, async (req) => {
    const engine = getFileSuggestionsEngine();
    if (!engine) throw new Error('pair: engine not initialized');
    const suggestion = engine.findSuggestion(req.suggestionId);
    if (!suggestion) throw new Error('pair: suggestion not found');

    const workspaceRoot = getSettings().activeWorkspace ?? null;
    const kindLabel =
      suggestion.changeKind === 'edit'
        ? 'edited'
        : suggestion.changeKind === 'create'
          ? 'created'
          : 'deleted';
    const lines = [
      `Pair suggestion — \`${suggestion.filePath}\` was ${kindLabel}.`,
      workspaceRoot ? `Workspace root: ${workspaceRoot}` : null,
      'Use this as additional context for the next turn.',
    ].filter((l): l is string => Boolean(l));

    await Promise.resolve(
      appendMessage({
        conversationId: suggestion.conversationId,
        role: 'system',
        content: lines.join('\n'),
      }),
    );

    engine.dismiss(req.suggestionId);

    return {
      ok: true,
      filePath: suggestion.filePath,
      conversationId: suggestion.conversationId,
    };
  });

  registerInvoke('pair:set-active-conversation', pairSetActiveConversationRequestSchema, (req) => {
    activeConversationId = req.conversationId;
    return { ok: true };
  });
}

export function resetPairForTests(): void {
  activeConversationId = null;
  setFileSuggestionsEngine(null);
}

export function setActivePairConversationForTests(id: string | null): void {
  activeConversationId = id;
}
