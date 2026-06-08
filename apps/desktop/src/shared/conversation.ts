import type { ContentBlock, Role } from '@opencodex/core';

export type TurnStatus = 'streaming' | 'final';

export interface Conversation {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  starred: boolean;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  contentBlocks: ContentBlock[] | null;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  createdAt: string;
  turnStatus: TurnStatus;
}

export interface AppendMessageRequest {
  conversationId: string;
  role: Role;
  content: string;
  contentBlocks?: ContentBlock[] | null;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  costUsd?: number | null;
  turnStatus?: TurnStatus;
}

export interface ConversationUsageByModel {
  providerId: string | null;
  modelId: string | null;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface ConversationUsage {
  conversationId: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCostUsd: number;
  byModel: ConversationUsageByModel[];
}

export type ConversationExportFormat = 'markdown' | 'json';

export interface ExportConversationRequest {
  id: string;
  format: ConversationExportFormat;
}

export interface ExportConversationResult {
  filename: string;
  savedTo: string | null;
}
