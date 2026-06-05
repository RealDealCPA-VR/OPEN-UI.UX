import { z } from 'zod';
import type { ChatEvent } from '@opencodex/core';
import type { ChatAttachment } from './attachments';
import type { StoredMessage } from './conversation';

export interface ChatStartRequest {
  conversationId: string;
  providerId: string;
  modelId: string;
  userMessage: string;
  attachments?: ChatAttachment[];
}

export interface ChatStartResponse {
  streamId: string;
  userMessageId: string;
  assistantMessageId: string;
  workspaceRoot: string;
}

export interface ChatStreamEvent {
  streamId: string;
  event: ChatEvent;
}

export interface ChatCancelRequest {
  streamId: string;
}

// Crash-restore — reattach to in-flight turns after a renderer reload, and
// surface persisted partials after a hard crash.

export interface ChatListActiveResponse {
  active: Array<{
    conversationId: string;
    streamId: string;
    assistantMessageId: string;
    live: true;
  }>;
  interrupted: Array<{
    conversationId: string;
    assistantMessageId: string;
  }>;
}

export const chatReattachRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export type ChatReattachRequest = z.infer<typeof chatReattachRequestSchema>;

export interface ChatReattachResponse {
  live: boolean;
  streamId: string | null;
  assistantMessageId: string | null;
  partial: StoredMessage | null;
}
