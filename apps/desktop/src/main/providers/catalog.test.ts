import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, ModelCapabilities, ProviderFactory } from '@opencodex/core';
import { buildProviderConfig, catalog, catalogById, getAllProviderInfo } from './catalog';
import {
  listPluginProviders,
  registerPluginProvider,
  unregisterPluginProvidersFor,
} from './plugin-provider-registry';

describe('provider catalog', () => {
  it('covers all eight phase-1 adapters', () => {
    const ids = catalog.map((e) => e.id).sort();
    expect(ids).toEqual([
      'anthropic',
      'google',
      'mistral',
      'ollama',
      'openai',
      'openrouter',
      'voyage',
      'xai',
    ]);
  });

  it('exposes each entry through catalogById', () => {
    for (const entry of catalog) {
      expect(catalogById.get(entry.id)).toBe(entry);
    }
  });

  it('marks ollama as not requiring an api key, others requiring one', () => {
    for (const entry of catalog) {
      if (entry.id === 'ollama') expect(entry.requiresApiKey).toBe(false);
      else expect(entry.requiresApiKey).toBe(true);
    }
  });

  it('loads model capabilities for every provider', async () => {
    const infos = await getAllProviderInfo();
    expect(infos.map((i) => i.id).sort()).toEqual(catalog.map((e) => e.id).sort());
    for (const info of infos) {
      expect(info.models.length).toBeGreaterThan(0);
      for (const model of info.models) {
        expect(model.providerId).toBe(info.id);
      }
    }
  });

  it('builds default ping specs that point at the documented base URL', () => {
    const openai = catalogById.get('openai')!;
    expect(openai.buildPingSpec({ apiKey: 'sk-test', baseUrl: undefined, extra: {} })).toEqual({
      url: 'https://api.openai.com/v1/models',
      method: 'GET',
      headers: { authorization: 'Bearer sk-test' },
      expectsAuth: true,
    });

    const anthropic = catalogById.get('anthropic')!;
    const aSpec = anthropic.buildPingSpec({
      apiKey: 'k',
      baseUrl: undefined,
      extra: { anthropicVersion: '2024-09-01' },
    });
    expect(aSpec.url).toBe('https://api.anthropic.com/v1/models');
    expect(aSpec.headers['x-api-key']).toBe('k');
    expect(aSpec.headers['anthropic-version']).toBe('2024-09-01');

    const google = catalogById.get('google')!;
    const gSpec = google.buildPingSpec({ apiKey: 'gkey', baseUrl: undefined, extra: {} });
    expect(gSpec.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=gkey');
    expect(gSpec.headers).toEqual({});

    const ollama = catalogById.get('ollama')!;
    expect(ollama.buildPingSpec({ apiKey: undefined, baseUrl: undefined, extra: {} }).url).toBe(
      'http://127.0.0.1:11434/api/tags',
    );

    const openrouter = catalogById.get('openrouter')!;
    const orSpec = openrouter.buildPingSpec({
      apiKey: 'ork',
      baseUrl: undefined,
      extra: {},
    });
    expect(orSpec.url).toBe('https://openrouter.ai/api/v1/auth/key');
    expect(orSpec.headers).toEqual({ authorization: 'Bearer ork' });
  });

  it('honours baseUrl overrides and strips trailing slash', () => {
    const openai = catalogById.get('openai')!;
    const spec = openai.buildPingSpec({
      apiKey: 'k',
      baseUrl: 'https://example.com/openai/',
      extra: {},
    });
    expect(spec.url).toBe('https://example.com/openai/models');
  });

  it('builds valid provider config when given a key and base URL', () => {
    const openai = catalogById.get('openai')!;
    const config = buildProviderConfig(openai, {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      extra: { organization: 'org-1', project: '' },
    });
    expect(config).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      organization: 'org-1',
    });
  });

  it('rejects invalid base URL via the provider config schema', () => {
    const openai = catalogById.get('openai')!;
    expect(() =>
      buildProviderConfig(openai, { apiKey: 'k', baseUrl: 'not a url', extra: {} }),
    ).toThrow();
  });
});

describe('getAllProviderInfo with plugin providers', () => {
  afterEach(() => {
    for (const e of listPluginProviders()) unregisterPluginProvidersFor(e.pluginId);
  });

  it('includes a registered plugin provider, marked as plugin-sourced', async () => {
    const pluginModel: ModelCapabilities = {
      id: 'acme-large',
      providerId: 'acme',
      displayName: 'Acme Large',
      contextWindow: 32_000,
      toolUse: true,
      vision: false,
      streaming: true,
      embeddings: false,
    };
    const factory: ProviderFactory = {
      id: 'acme',
      displayName: 'Acme',
      configSchema: z.object({ apiKey: z.string().optional() }),
      create: () =>
        ({
          id: 'acme',
          displayName: 'Acme',
          listModels: async () => [pluginModel],
        }) as unknown as LLMProvider,
    } as unknown as ProviderFactory;

    registerPluginProvider({ pluginId: 'p1', id: 'acme', displayName: 'Acme', factory });

    const infos = await getAllProviderInfo();
    const acme = infos.find((i) => i.id === 'acme');
    expect(acme).toBeDefined();
    expect(acme?.source).toBe('plugin');
    expect(acme?.models.map((m) => m.id)).toEqual(['acme-large']);
  });
});
