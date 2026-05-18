import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'mistral-large-latest',
    providerId: 'mistral',
    displayName: 'Mistral Large',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 2, outputPerMillion: 6 },
  },
  {
    id: 'mistral-medium-latest',
    providerId: 'mistral',
    displayName: 'Mistral Medium',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 0.4, outputPerMillion: 2 },
  },
  {
    id: 'mistral-small-latest',
    providerId: 'mistral',
    displayName: 'Mistral Small',
    contextWindow: 32_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  },
  {
    id: 'pixtral-large-latest',
    providerId: 'mistral',
    displayName: 'Pixtral Large',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: true,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 2, outputPerMillion: 6 },
  },
  {
    id: 'codestral-latest',
    providerId: 'mistral',
    displayName: 'Codestral',
    contextWindow: 256_000,
    maxOutputTokens: 8_192,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
    pricing: { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  },
  {
    id: 'mistral-embed',
    providerId: 'mistral',
    displayName: 'Mistral Embed',
    contextWindow: 8_192,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0 },
  },
];

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}
