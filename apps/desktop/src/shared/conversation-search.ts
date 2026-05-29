import { z } from 'zod';

export const conversationSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(200).optional(),
  conversationId: z.string().min(1).optional(),
});

export type ConversationSearchRequest = z.infer<typeof conversationSearchRequestSchema>;

export interface ConversationSearchHit {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  createdAt: string;
  snippet: string;
  score: number;
}

export interface ConversationSearchResponse {
  hits: ConversationSearchHit[];
  truncated: boolean;
}

export const scrollToMessageEventSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});

export type ScrollToMessageEvent = z.infer<typeof scrollToMessageEventSchema>;
