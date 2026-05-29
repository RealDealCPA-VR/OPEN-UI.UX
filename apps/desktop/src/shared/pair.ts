import { z } from 'zod';

export const pairChangeKindSchema = z.enum(['edit', 'create', 'delete']);

export type PairChangeKind = z.infer<typeof pairChangeKindSchema>;

export const pairSuggestionSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  filePath: z.string().min(1),
  changeKind: pairChangeKindSchema,
  createdAt: z.string().min(1),
});

export type PairSuggestion = z.infer<typeof pairSuggestionSchema>;

export const pairSuggestionEventSchema = z.object({
  suggestion: pairSuggestionSchema,
});

export type PairSuggestionEvent = z.infer<typeof pairSuggestionEventSchema>;

export const pairGetActiveSuggestionsRequestSchema = z.object({
  conversationId: z.string().min(1).optional(),
});

export type PairGetActiveSuggestionsRequest = z.infer<typeof pairGetActiveSuggestionsRequestSchema>;

export const pairGetActiveSuggestionsResponseSchema = z.object({
  suggestions: z.array(pairSuggestionSchema),
});

export type PairGetActiveSuggestionsResponse = z.infer<
  typeof pairGetActiveSuggestionsResponseSchema
>;

export const pairUserResponseSchema = z.enum(['apply-as-context', 'ignore']);

export type PairUserResponse = z.infer<typeof pairUserResponseSchema>;

export const pairDismissSuggestionRequestSchema = z.object({
  suggestionId: z.string().min(1),
});

export type PairDismissSuggestionRequest = z.infer<typeof pairDismissSuggestionRequestSchema>;

export const pairDismissSuggestionResponseSchema = z.object({
  ok: z.boolean(),
});

export type PairDismissSuggestionResponse = z.infer<typeof pairDismissSuggestionResponseSchema>;

export const pairApplyAsContextRequestSchema = z.object({
  suggestionId: z.string().min(1),
});

export type PairApplyAsContextRequest = z.infer<typeof pairApplyAsContextRequestSchema>;

export const pairApplyAsContextResponseSchema = z.object({
  ok: z.boolean(),
  filePath: z.string(),
  conversationId: z.string(),
});

export type PairApplyAsContextResponse = z.infer<typeof pairApplyAsContextResponseSchema>;

export const pairSetActiveConversationRequestSchema = z.object({
  conversationId: z.string().nullable(),
});

export type PairSetActiveConversationRequest = z.infer<
  typeof pairSetActiveConversationRequestSchema
>;

export interface PairIpcInvokeChannels {
  'pair:get-active-suggestions': {
    request: PairGetActiveSuggestionsRequest;
    response: PairGetActiveSuggestionsResponse;
  };
  'pair:dismiss-suggestion': {
    request: PairDismissSuggestionRequest;
    response: PairDismissSuggestionResponse;
  };
  'pair:apply-as-context': {
    request: PairApplyAsContextRequest;
    response: PairApplyAsContextResponse;
  };
  'pair:set-active-conversation': {
    request: PairSetActiveConversationRequest;
    response: { ok: boolean };
  };
}

export interface PairIpcEventChannels {
  'pair:suggestion': PairSuggestionEvent;
}
