import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'claude-opus-4-8',
    providerId: 'anthropic',
    displayName: 'Claude Opus 4.8',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5 },
  },
  {
    id: 'claude-opus-4-7',
    providerId: 'anthropic',
    displayName: 'Claude Opus 4.7',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5 },
  },
  {
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  },
  {
    id: 'claude-haiku-4-5',
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
];

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  const exact = KNOWN.find((m) => m.id === id);
  if (exact) return exact;
  // Dated snapshot IDs (e.g. claude-haiku-4-5-20251001) alias their bare entry.
  const dateless = id.replace(/-\d{8}$/, '');
  if (dateless !== id) return KNOWN.find((m) => m.id === dateless);
  return undefined;
}

export function defaultMaxTokens(modelId: string): number {
  return findModel(modelId)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}
