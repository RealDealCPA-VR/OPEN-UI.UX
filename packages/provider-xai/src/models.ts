import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'grok-4',
    providerId: 'xai',
    displayName: 'Grok 4',
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.75 },
  },
  {
    id: 'grok-4-fast-reasoning',
    providerId: 'xai',
    displayName: 'Grok 4 Fast (reasoning)',
    contextWindow: 2_000_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.5, cachedInputPerMillion: 0.05 },
  },
  {
    id: 'grok-3',
    providerId: 'xai',
    displayName: 'Grok 3',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
  },
  {
    id: 'grok-3-mini',
    providerId: 'xai',
    displayName: 'Grok 3 mini',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 0.5 },
  },
  {
    id: 'grok-code-fast-1',
    providerId: 'xai',
    displayName: 'Grok Code Fast 1',
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 1.5, cachedInputPerMillion: 0.02 },
  },
];

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}
