import { describe, expect, it } from 'vitest';
import type { ModelCapabilities } from '@opencodex/core';
import { buildOllamaModelCapabilities } from './ollama-models';

const KNOWN: ModelCapabilities[] = [
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
    id: 'nomic-embed-text',
    providerId: 'ollama',
    displayName: 'nomic-embed-text',
    contextWindow: 8_192,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
];

describe('buildOllamaModelCapabilities', () => {
  it('matches a tagged model to its curated family, keeping the real tag', () => {
    const [m] = buildOllamaModelCapabilities(['llama3.1:8b'], KNOWN);
    expect(m?.id).toBe('llama3.1:8b');
    expect(m?.displayName).toBe('llama3.1:8b');
    expect(m?.toolUse).toBe(true);
    expect(m?.contextWindow).toBe(128_000);
  });

  it('synthesizes conservative defaults for unknown models', () => {
    const [m] = buildOllamaModelCapabilities(['phi3:mini'], KNOWN);
    expect(m?.id).toBe('phi3:mini');
    expect(m?.providerId).toBe('ollama');
    expect(m?.toolUse).toBe(false);
    expect(m?.embeddings).toBe(false);
    expect(m?.streaming).toBe(true);
    expect(m?.contextWindow).toBeGreaterThan(0);
  });

  it('flags embedding models by name even when not curated', () => {
    const [m] = buildOllamaModelCapabilities(['snowflake-arctic-embed:latest'], KNOWN);
    expect(m?.embeddings).toBe(true);
    expect(m?.streaming).toBe(false);
  });

  it('flags vision models by name', () => {
    const [m] = buildOllamaModelCapabilities(['llava:13b'], KNOWN);
    expect(m?.vision).toBe(true);
  });

  it('dedupes repeated tags', () => {
    expect(buildOllamaModelCapabilities(['mistral:7b', 'mistral:7b'], KNOWN)).toHaveLength(1);
  });

  it('returns nothing for an empty live list', () => {
    expect(buildOllamaModelCapabilities([], KNOWN)).toEqual([]);
  });
});
