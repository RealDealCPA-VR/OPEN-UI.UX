import type { Role } from '@opencodex/core';

export interface Conversation {
  id: string;
  title: string;
  providerId: string | null;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface AppendMessageRequest {
  conversationId: string;
  role: Role;
  content: string;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

export interface ConversationUsageByModel {
  providerId: string | null;
  modelId: string | null;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ConversationUsage {
  conversationId: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
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
