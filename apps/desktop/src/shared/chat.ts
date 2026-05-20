import type { ChatEvent } from '@opencodex/core';

export interface ChatStartRequest {
  conversationId: string;
  providerId: string;
  modelId: string;
  userMessage: string;
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
