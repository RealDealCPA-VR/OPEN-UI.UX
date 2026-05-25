import type { ChatEvent } from '@opencodex/core';
import type { ChatAttachment } from './attachments';

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
