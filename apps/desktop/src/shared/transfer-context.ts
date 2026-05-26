import { z } from 'zod';

export const TransferContextSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chat-to-agent'),
    conversationId: z.string(),
    lastUserMessage: z.string(),
    workspaceRoot: z.string(),
  }),
  z.object({
    kind: z.literal('chat-to-codebase'),
    filePaths: z.array(z.string()),
    workspaceRoot: z.string(),
  }),
  z.object({
    kind: z.literal('agent-to-chat'),
    runId: z.string(),
    summary: z.string(),
  }),
  z.object({
    kind: z.literal('codebase-to-chat'),
    filePath: z.string(),
  }),
]);

export type TransferContext = z.infer<typeof TransferContextSchema>;
