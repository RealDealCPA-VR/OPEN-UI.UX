import type { ModelCapabilities } from '@opencodex/core';

const KNOWN: ReadonlyArray<ModelCapabilities> = [
  {
    id: 'llama3.1',
    providerId: 'ollama',
    displayName: 'Llama 3.1',
    contextWindow: 128_000,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'llama3.2',
    providerId: 'ollama',
    displayName: 'Llama 3.2',
    contextWindow: 128_000,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'qwen2.5',
    providerId: 'ollama',
    displayName: 'Qwen 2.5',
    contextWindow: 32_768,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'qwen2.5-coder',
    providerId: 'ollama',
    displayName: 'Qwen 2.5 Coder',
    contextWindow: 32_768,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'mistral',
    providerId: 'ollama',
    displayName: 'Mistral',
    contextWindow: 32_768,
    toolUse: true,
    vision: false,
    streaming: true,
    embeddings: false,
  },
  {
    id: 'nomic-embed-text',
    providerId: 'ollama',
    displayName: 'nomic-embed-text',
    contextWindow: 8_192,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
  {
    id: 'mxbai-embed-large',
    providerId: 'ollama',
    displayName: 'mxbai-embed-large',
    contextWindow: 512,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
];

export function knownModels(): ModelCapabilities[] {
  return KNOWN.map((m) => ({ ...m }));
}

export function findModel(id: string): ModelCapabilities | undefined {
  return KNOWN.find((m) => m.id === id);
}
