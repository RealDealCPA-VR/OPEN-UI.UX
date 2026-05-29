import { z } from 'zod';

export const appliedDiffSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  toolCallId: z.string().nullable(),
  filePath: z.string(),
  diff: z.string(),
  promptSnapshot: z.string().nullable(),
  ragCitationsJson: z.string().nullable(),
  routingDecisionJson: z.string().nullable(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  tokensInput: z.number().int().nullable(),
  tokensOutput: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  seed: z.number().int().nullable(),
  appliedAt: z.string(),
});

export type AppliedDiff = z.infer<typeof appliedDiffSchema>;

export const listAppliedDiffsRequestSchema = z.object({
  conversationId: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type ListAppliedDiffsRequest = z.infer<typeof listAppliedDiffsRequestSchema>;

export interface ListAppliedDiffsResponse {
  rows: AppliedDiff[];
  total: number;
}

export const getAppliedDiffRequestSchema = z.object({
  id: z.string().min(1),
});

export type GetAppliedDiffRequest = z.infer<typeof getAppliedDiffRequestSchema>;

export const exportProvenanceBundleRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export type ExportProvenanceBundleRequest = z.infer<typeof exportProvenanceBundleRequestSchema>;

export interface ProvenanceBundleMessage {
  id: string;
  role: string;
  content: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: string;
}

export const PROVENANCE_BUNDLE_FORMAT = 'opencodex-provenance-v1' as const;

export interface ProvenanceBundle {
  format: typeof PROVENANCE_BUNDLE_FORMAT;
  bundleVersion: 1;
  exportedAt: string;
  deviceId: string;
  publicKey: string;
  conversation: {
    id: string;
    title: string;
    providerId: string | null;
    modelId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: ProvenanceBundleMessage[];
  appliedDiffs: AppliedDiff[];
}

export interface SignedProvenanceBundle {
  bundle: ProvenanceBundle;
  signature: string;
}

export interface ExportProvenanceBundleResponse {
  filename: string;
  savedTo: string | null;
  bundle: ProvenanceBundle | null;
  signature: string | null;
}

export const replayConversationRequestSchema = z.object({
  conversationId: z.string().min(1),
  targetProviderId: z.string().min(1),
  targetModelId: z.string().min(1),
  diffAgainstOriginal: z.boolean().optional(),
});

export type ReplayConversationRequest = z.infer<typeof replayConversationRequestSchema>;

export interface ReplayMessagePair {
  originalMessageId: string;
  originalContent: string;
  replayContent: string;
  contentChanged: boolean;
}

export interface ReplayResult {
  replayId: string;
  sourceConversationId: string;
  clonedConversationId: string | null;
  targetProviderId: string;
  targetModelId: string;
  startedAt: string;
  completedAt: string;
  messagesReplayed: number;
  pairs: ReplayMessagePair[];
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  errors: string[];
}

export const replayDiffRequestSchema = z.object({
  appliedDiffId: z.string().min(1),
  targetProviderId: z.string().min(1),
  targetModelId: z.string().min(1),
});

export type ReplayDiffRequest = z.infer<typeof replayDiffRequestSchema>;

export interface ReplayDiffResult {
  appliedDiffId: string;
  filePath: string;
  originalDiff: string;
  replayContent: string;
  targetProviderId: string;
  targetModelId: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

export interface ReplayProgressEvent {
  replayId: string;
  stage: 'starting' | 'message' | 'completed' | 'error';
  messageIndex?: number;
  totalMessages?: number;
  error?: string;
}

export const DIFF_PRODUCING_TOOL_NAMES = ['edit_file', 'write_file'] as const;

export type DiffProducingToolName = (typeof DIFF_PRODUCING_TOOL_NAMES)[number];

export function isDiffProducingTool(name: string): name is DiffProducingToolName {
  return (DIFF_PRODUCING_TOOL_NAMES as readonly string[]).includes(name);
}
