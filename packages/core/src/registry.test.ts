import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderConfigError, ProviderRegistry } from './registry';
import { providerConfigSchema, type LLMProvider, type ProviderFactory } from './provider';

const stubProvider: LLMProvider = {
  id: 'stub',
  displayName: 'Stub',
  async *chat() {
    yield { type: 'done', stopReason: 'end_turn' };
  },
  async embed() {
    return { embeddings: [[0]], usage: { tokens: 1 } };
  },
  async listModels() {
    return [];
  },
  async capabilities() {
    return undefined;
  },
};

const baseFactory: ProviderFactory = {
  id: 'stub',
  displayName: 'Stub',
  configSchema: providerConfigSchema,
  create: () => stubProvider,
};

describe('ProviderRegistry', () => {
  it('registers and retrieves a factory', () => {
    const registry = new ProviderRegistry();
    registry.register(baseFactory);
    expect(registry.has('stub')).toBe(true);
    expect(registry.get('stub')).toBe(baseFactory);
    expect(registry.list()).toEqual([baseFactory]);
  });

  it('rejects duplicate registration', () => {
    const registry = new ProviderRegistry();
    registry.register(baseFactory);
    expect(() => registry.register(baseFactory)).toThrow(/already registered/);
  });

  it('unregisters a factory', () => {
    const registry = new ProviderRegistry();
    registry.register(baseFactory);
    expect(registry.unregister('stub')).toBe(true);
    expect(registry.has('stub')).toBe(false);
    expect(registry.unregister('stub')).toBe(false);
  });

  it('creates a provider with a valid config', () => {
    const registry = new ProviderRegistry();
    registry.register(baseFactory);
    const provider = registry.create('stub', { apiKey: 'sk-test' });
    expect(provider.id).toBe('stub');
  });

  it('throws ProviderConfigError on invalid config', () => {
    const strictFactory: ProviderFactory<{ apiKey: string }> = {
      id: 'strict',
      displayName: 'Strict',
      configSchema: z.object({ apiKey: z.string().min(1) }),
      create: () => stubProvider,
    };
    const registry = new ProviderRegistry();
    registry.register(strictFactory as ProviderFactory);

    expect(() => registry.create('strict', {})).toThrow(ProviderConfigError);
    try {
      registry.create('strict', {});
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderConfigError);
      const e = err as ProviderConfigError;
      expect(e.providerId).toBe('strict');
      expect(e.issues.length).toBeGreaterThan(0);
    }
  });

  it('throws on create for unknown provider id', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.create('nope', {})).toThrow(/not registered/);
  });

  it('rejects malformed baseUrl in providerConfigSchema', () => {
    const parsed = providerConfigSchema.safeParse({ baseUrl: 'not-a-url' });
    expect(parsed.success).toBe(false);
  });
});
