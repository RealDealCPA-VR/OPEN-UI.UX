import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'claude-opus-4-7',
    providerId: 'anthropic',
    displayName: 'Claude Opus 4.7',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5 },
  },
  {
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    providerId: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 1, outputPerMillion: 5, cachedInputPerMillion: 0.1 },
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  },
  {
    id: 'claude-3-5-haiku-20241022',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },
  },
];

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}

export function defaultMaxTokens(modelId: string): number {
  return findModel(modelId)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}
