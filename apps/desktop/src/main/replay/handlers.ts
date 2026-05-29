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
  type ReplayProgressEvent,
} from '../../shared/replay';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { buildProviderForId } from '../chat/provider-builder';
import { getAppliedDiff, listAppliedDiffs } from '../storage/applied-diffs';
import { buildSignedProvenanceBundle } from './provenance-bundle';
import { replayConversation, replayDiff } from './replay-engine';

function broadcastReplayProgress(event: ReplayProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('replay:progress', event);
  }
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
      const signed = await buildSignedProvenanceBundle(req.conversationId);
      if (!signed) {
        return { filename: 'provenance.json', savedTo: null, bundle: null, signature: null };
      }
      const { bundle, signature } = signed;
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
        return { filename, savedTo: null, bundle, signature };
      }
      await writeFile(result.filePath, JSON.stringify(signed, null, 2), 'utf8');
      logger.info(
        { conversationId: req.conversationId, path: result.filePath },
        'provenance bundle exported',
      );
      return { filename, savedTo: result.filePath, bundle, signature };
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

  registerInvoke(
    'replay:get-conversation-bundle',
    z.object({ id: z.string().min(1) }),
    async (req) => {
      const signed = await buildSignedProvenanceBundle(req.id);
      if (!signed) return { bundle: null, signature: null };
      return { bundle: signed.bundle, signature: signed.signature };
    },
  );
}
