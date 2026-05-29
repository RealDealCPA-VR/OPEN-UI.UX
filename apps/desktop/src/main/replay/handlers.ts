import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  exportProvenanceBundleRequestSchema,
  getAppliedDiffRequestSchema,
  listAppliedDiffsRequestSchema,
  replayConversationRequestSchema,
  replayDiffRequestSchema,
  type ExportProvenanceBundleResponse,
  type ProvenanceBundle,
  type ProvenanceBundleMessage,
  type ReplayProgressEvent,
} from '../../shared/replay';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { buildProviderForId } from '../chat/provider-builder';
import {
  getAppliedDiff,
  listAppliedDiffs,
  listAppliedDiffsForConversation,
} from '../storage/applied-diffs';
import { getConversation, listMessages } from '../storage/conversations';
import { replayConversation, replayDiff } from './replay-engine';

function broadcastReplayProgress(event: ReplayProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('replay:progress', event);
  }
}

function buildProvenanceBundle(conversationId: string): ProvenanceBundle | null {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  const stored = listMessages(conversationId);
  const messages: ProvenanceBundleMessage[] = stored.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    providerId: m.providerId,
    modelId: m.modelId,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    costUsd: m.costUsd,
    createdAt: m.createdAt,
  }));
  const appliedDiffs = listAppliedDiffsForConversation(conversationId);
  return {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    conversation,
    messages,
    appliedDiffs,
  };
}

export function registerReplayHandlers(): void {
  registerInvoke('replay:list-applied-diffs', listAppliedDiffsRequestSchema, (req) =>
    listAppliedDiffs(req),
  );

  registerInvoke('replay:get-applied-diff', getAppliedDiffRequestSchema, (req) =>
    getAppliedDiff(req.id),
  );

  registerInvoke(
    'replay:export-provenance-bundle',
    exportProvenanceBundleRequestSchema,
    async (req): Promise<ExportProvenanceBundleResponse> => {
      const bundle = buildProvenanceBundle(req.conversationId);
      if (!bundle) {
        return { filename: 'provenance.json', savedTo: null, bundle: null };
      }
      const filename = `provenance-${bundle.conversation.id}.json`;
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
      const opts = {
        defaultPath: filename,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      };
      const result = parent
        ? await dialog.showSaveDialog(parent, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) {
        return { filename, savedTo: null, bundle };
      }
      await writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf8');
      logger.info(
        { conversationId: req.conversationId, path: result.filePath },
        'provenance bundle exported',
      );
      return { filename, savedTo: result.filePath, bundle };
    },
  );

  registerInvoke('replay:replay-conversation', replayConversationRequestSchema, async (req) => {
    return replayConversation({
      request: req,
      buildProvider: buildProviderForId,
      onProgress: broadcastReplayProgress,
    });
  });

  registerInvoke('replay:replay-diff', replayDiffRequestSchema, async (req) => {
    return replayDiff({
      request: req,
      buildProvider: buildProviderForId,
    });
  });

  registerInvoke('replay:get-conversation-bundle', z.object({ id: z.string().min(1) }), (req) => {
    const bundle = buildProvenanceBundle(req.id);
    return { bundle };
  });
}
