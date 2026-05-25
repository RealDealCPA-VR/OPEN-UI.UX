import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { resolveSelectedModel } from '../selected-model/resolve';
import { buildConversationExport } from '../storage/conversation-export';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getConversationUsage,
  listConversations,
  listMessages,
  renameConversation,
} from '../storage/conversations';
import { getSettings } from '../storage/settings';
import { cancelChatStream, startChatStream, type ChatStreamSink } from './runner';
import { prepareAttachments } from './attachments';

const roleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

function broadcast(): ChatStreamSink {
  return {
    emit(payload) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('chat:event', payload);
      }
    },
    emitShellOutput(payload) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('shell:output', payload);
      }
    },
  };
}

export function registerChatHandlers(): void {
  registerInvoke('conversations:list', z.void(), () => listConversations());

  registerInvoke(
    'conversations:create',
    z.object({
      title: z.string().optional(),
      providerId: z.string().nullable().optional(),
      modelId: z.string().nullable().optional(),
    }),
    (req) =>
      createConversation({
        ...(req.title !== undefined ? { title: req.title } : {}),
        providerId: req.providerId ?? null,
        modelId: req.modelId ?? null,
      }),
  );

  registerInvoke(
    'conversations:rename',
    z.object({ id: z.string().min(1), title: z.string().min(1) }),
    (req) => renameConversation(req.id, req.title),
  );

  registerInvoke('conversations:delete', z.object({ id: z.string().min(1) }), (req) => {
    deleteConversation(req.id);
  });

  registerInvoke('conversations:messages', z.object({ id: z.string().min(1) }), (req) =>
    listMessages(req.id),
  );

  registerInvoke(
    'conversations:appendMessage',
    z.object({
      conversationId: z.string().min(1),
      role: roleSchema,
      content: z.string(),
      providerId: z.string().nullable().optional(),
      modelId: z.string().nullable().optional(),
      inputTokens: z.number().int().nonnegative().nullable().optional(),
      outputTokens: z.number().int().nonnegative().nullable().optional(),
      costUsd: z.number().nonnegative().nullable().optional(),
    }),
    (req) => appendMessage(req),
  );

  registerInvoke('conversations:usage', z.object({ id: z.string().min(1) }), (req) =>
    getConversationUsage(req.id),
  );

  registerInvoke(
    'conversations:export',
    z.object({ id: z.string().min(1), format: z.enum(['markdown', 'json']) }),
    async (req) => {
      const payload = buildConversationExport(req.id, req.format);
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
      const filters =
        req.format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }];
      const result = parent
        ? await dialog.showSaveDialog(parent, { defaultPath: payload.filename, filters })
        : await dialog.showSaveDialog({ defaultPath: payload.filename, filters });
      if (result.canceled || !result.filePath) {
        return { filename: payload.filename, savedTo: null };
      }
      await writeFile(result.filePath, payload.content, 'utf8');
      logger.info(
        { conversationId: req.id, format: req.format, path: result.filePath },
        'conversation exported',
      );
      return { filename: payload.filename, savedTo: result.filePath };
    },
  );

  const attachmentImageSchema = z.object({
    kind: z.literal('image'),
    name: z.string(),
    path: z.string(),
    mimeType: z.string(),
    data: z.string(),
    sizeBytes: z.number().int().nonnegative(),
  });
  const attachmentTextSchema = z.object({
    kind: z.literal('text'),
    name: z.string(),
    path: z.string(),
    mimeType: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    sizeBytes: z.number().int().nonnegative(),
  });
  const attachmentBinarySchema = z.object({
    kind: z.literal('binary'),
    name: z.string(),
    path: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
  });
  const attachmentSchema = z.discriminatedUnion('kind', [
    attachmentImageSchema,
    attachmentTextSchema,
    attachmentBinarySchema,
  ]);

  registerInvoke('attachments:prepare', z.object({ paths: z.array(z.string().min(1)) }), (req) =>
    prepareAttachments(req.paths),
  );

  registerInvoke(
    'chat:start',
    z.object({
      conversationId: z.string().min(1),
      providerId: z.string().min(1),
      modelId: z.string().min(1),
      userMessage: z.string().min(1),
      attachments: z.array(attachmentSchema).optional(),
    }),
    async (req) => {
      const caps = await resolveSelectedModel({
        providerId: req.providerId,
        modelId: req.modelId,
      });
      if (!caps) {
        throw new Error(`Model ${req.providerId}/${req.modelId} is not in the catalog`);
      }
      const workspaceRoot = getSettings().activeWorkspace ?? process.cwd();
      logger.info(
        {
          providerId: req.providerId,
          modelId: req.modelId,
          conversationId: req.conversationId,
          workspaceRoot,
          attachments: req.attachments?.length ?? 0,
        },
        'chat stream starting',
      );
      return startChatStream({
        conversationId: req.conversationId,
        providerId: req.providerId,
        modelId: req.modelId,
        userMessage: req.userMessage,
        attachments: req.attachments ?? [],
        sink: broadcast(),
        workspaceRoot,
      });
    },
  );

  registerInvoke('chat:cancel', z.object({ streamId: z.string().min(1) }), (req) => {
    cancelChatStream(req.streamId);
  });
}
