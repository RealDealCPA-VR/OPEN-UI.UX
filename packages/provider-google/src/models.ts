import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'gemini-2.5-pro',
    providerId: 'google',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.31 },
  },
  {
    id: 'gemini-2.5-flash',
    providerId: 'google',
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.075 },
  },
  {
    id: 'gemini-2.0-flash',
    providerId: 'google',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.025 },
  },
  {
    id: 'gemini-1.5-pro',
    providerId: 'google',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2_000_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 5, cachedInputPerMillion: 0.3125 },
  },
  {
    id: 'gemini-1.5-flash',
    providerId: 'google',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    promptCaching: true,
    pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3, cachedInputPerMillion: 0.01875 },
  },
];

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}
