import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../storage/db';
import { appendMessage, createConversation } from '../storage/conversations';
import type { ProviderInfo } from '../../shared/provider-config';
import { estimateCostFromTokens, estimateCostsAcrossProviders } from './cost-comparison';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

function mkProvider(id: string, displayName: string, models: ProviderInfo['models']): ProviderInfo {
  return {
    id,
    displayName,
    requiresApiKey: true,
    defaultBaseUrl: '',
    extraFields: [],
    models,
  };
}

describe('estimateCostFromTokens', () => {
  it('multiplies tokens by per-million pricing', () => {
    const cost = estimateCostFromTokens(2_000_000, 500_000, {
      inputPerMillion: 1.5,
      outputPerMillion: 3,
    });
    expect(cost).toBeCloseTo(2 * 1.5 + 0.5 * 3, 6);
  });

  it('returns zero on zero tokens', () => {
    const cost = estimateCostFromTokens(0, 0, {
      inputPerMillion: 10,
      outputPerMillion: 20,
    });
    expect(cost).toBe(0);
  });
});

describe('estimateCostsAcrossProviders', () => {
  it('returns empty estimates when no configured providers', () => {
    const c = createConversation({ title: 'c' }, db);
    const res = estimateCostsAcrossProviders(c.id, { providers: [], db });
    expect(res.estimates).toEqual([]);
    expect(res.totalInputTokens).toBe(0);
    expect(res.totalOutputTokens).toBe(0);
  });

  it('estimates costs from stored message tokens and sorts cheapest first', () => {
    const c = createConversation({ title: 'c' }, db);
    appendMessage(
      {
        conversationId: c.id,
        role: 'assistant',
        content: 'hi',
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.001,
      },
      db,
    );

    const expensive = mkProvider('anthropic', 'Anthropic', [
      {
        id: 'opus',
        providerId: 'anthropic',
        displayName: 'Claude Opus',
        contextWindow: 200_000,
        toolUse: true,
        vision: false,
        streaming: true,
        embeddings: false,
        pricing: { inputPerMillion: 15, outputPerMillion: 75 },
      },
    ]);
    const cheap = mkProvider('openai', 'OpenAI', [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        displayName: 'GPT-4o mini',
        contextWindow: 128_000,
        toolUse: true,
        vision: true,
        streaming: true,
        embeddings: false,
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
      },
    ]);

    const res = estimateCostsAcrossProviders(c.id, {
      providers: [
        { info: expensive, configured: true },
        { info: cheap, configured: true },
      ],
      db,
    });
    expect(res.estimates).toHaveLength(2);
    expect(res.estimates[0]?.providerId).toBe('openai');
    expect(res.estimates[1]?.providerId).toBe('anthropic');
    expect(res.totalInputTokens).toBe(1000);
    expect(res.totalOutputTokens).toBe(500);
  });

  it('skips unconfigured providers and embeddings-only models', () => {
    const c = createConversation({ title: 'c' }, db);
    appendMessage(
      {
        conversationId: c.id,
        role: 'assistant',
        content: 'x',
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
      },
      db,
    );

    const p = mkProvider('voyage', 'Voyage', [
      {
        id: 'voyage-3',
        providerId: 'voyage',
        displayName: 'Voyage 3',
        contextWindow: 32_000,
        toolUse: false,
        vision: false,
        streaming: false,
        embeddings: true,
        pricing: { inputPerMillion: 0.06, outputPerMillion: 0 },
      },
    ]);
    const q = mkProvider('openai', 'OpenAI', [
      {
        id: 'gpt-4o',
        providerId: 'openai',
        displayName: 'GPT-4o',
        contextWindow: 128_000,
        toolUse: true,
        vision: true,
        streaming: true,
        embeddings: false,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
      },
    ]);

    const res = estimateCostsAcrossProviders(c.id, {
      providers: [
        { info: p, configured: true },
        { info: q, configured: false },
      ],
      db,
    });
    expect(res.estimates).toEqual([]);
  });

  it('marks models without pricing as knownPricing=false and ranks them last', () => {
    const c = createConversation({ title: 'c' }, db);
    appendMessage(
      {
        conversationId: c.id,
        role: 'assistant',
        content: 'x',
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
      },
      db,
    );

    const noPrice = mkProvider('local', 'Local', [
      {
        id: 'llama',
        providerId: 'local',
        displayName: 'Llama 3',
        contextWindow: 32_000,
        toolUse: true,
        vision: false,
        streaming: true,
        embeddings: false,
      },
    ]);
    const priced = mkProvider('openai', 'OpenAI', [
      {
        id: 'gpt-4o',
        providerId: 'openai',
        displayName: 'GPT-4o',
        contextWindow: 128_000,
        toolUse: true,
        vision: true,
        streaming: true,
        embeddings: false,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
      },
    ]);

    const res = estimateCostsAcrossProviders(c.id, {
      providers: [
        { info: noPrice, configured: true },
        { info: priced, configured: true },
      ],
      db,
    });
    expect(res.estimates[0]?.providerId).toBe('openai');
    expect(res.estimates[0]?.knownPricing).toBe(true);
    expect(res.estimates[1]?.providerId).toBe('local');
    expect(res.estimates[1]?.knownPricing).toBe(false);
  });
});
