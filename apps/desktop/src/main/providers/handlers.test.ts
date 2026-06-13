import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, ModelCapabilities, ProviderFactory } from '@opencodex/core';
import type {
  ProviderListItem,
  ProviderSaveResponse,
  ProviderTestResult,
} from '../../shared/provider-config';
import { registerProviderHandlers } from './handlers';
import {
  listPluginProviders,
  registerPluginProvider,
  unregisterPluginProvidersFor,
} from './plugin-provider-registry';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '.' },
}));

vi.mock('../logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

const secrets = new Map<string, string>();

vi.mock('../storage/secrets', () => ({
  getSecret: async (account: string) => secrets.get(account) ?? null,
  setSecret: async (account: string, value: string) => {
    secrets.set(account, value);
  },
  deleteSecret: async (account: string) => {
    secrets.delete(account);
  },
}));

interface StoredEntry {
  baseUrl: string | null;
  extra: Record<string, string>;
  lastTestedAt: string | null;
  lastTestResult: ProviderTestResult | null;
}

const providerEntries = new Map<string, StoredEntry>();
const emptyEntry = (): StoredEntry => ({
  baseUrl: null,
  extra: {},
  lastTestedAt: null,
  lastTestResult: null,
});

vi.mock('../storage/settings', () => ({
  getProviderEntry: (id: string) => providerEntries.get(id) ?? emptyEntry(),
  setProviderEntry: (id: string, patch: Partial<StoredEntry>) => {
    const next = { ...(providerEntries.get(id) ?? emptyEntry()), ...patch };
    providerEntries.set(id, next);
    return next;
  },
  deleteProviderEntry: (id: string) => {
    providerEntries.delete(id);
  },
  clearSelectedModelEverywhere: () => ({
    removed: 0,
    store: { global: null, byConversation: {}, byWorkspace: {} },
  }),
}));

type InvokeHandler = (req: unknown) => Promise<unknown> | unknown;
const invokeHandlers = new Map<string, InvokeHandler>();

vi.mock('../ipc/registry', () => ({
  registerInvoke: (channel: string, _schema: unknown, handler: InvokeHandler) => {
    invokeHandlers.set(channel, handler);
  },
}));

const acmeModel: ModelCapabilities = {
  id: 'acme-large',
  providerId: 'acme',
  displayName: 'Acme Large',
  contextWindow: 32_000,
  toolUse: true,
  vision: false,
  streaming: true,
  embeddings: false,
};

function acmeFactory(listModels: () => Promise<ModelCapabilities[]>): ProviderFactory {
  return {
    id: 'acme',
    displayName: 'Acme',
    configSchema: z.object({
      apiKey: z.string().min(1),
      baseUrl: z.string().url().optional(),
    }),
    create: () =>
      ({
        id: 'acme',
        displayName: 'Acme',
        listModels,
      }) as unknown as LLMProvider,
  } as unknown as ProviderFactory;
}

function registerAcme(listModels: () => Promise<ModelCapabilities[]> = async () => [acmeModel]) {
  registerPluginProvider({
    pluginId: 'p1',
    id: 'acme',
    displayName: 'Acme',
    factory: acmeFactory(listModels),
  });
}

function handler(channel: string): InvokeHandler {
  const h = invokeHandlers.get(channel);
  if (!h) throw new Error(`handler ${channel} not registered`);
  return h;
}

describe('provider handlers — plugin provider fallback', () => {
  beforeEach(() => {
    secrets.clear();
    providerEntries.clear();
    invokeHandlers.clear();
    registerProviderHandlers();
  });

  afterEach(() => {
    for (const e of listPluginProviders()) unregisterPluginProvidersFor(e.pluginId);
  });

  it('saves an API key for a plugin-contributed provider', async () => {
    registerAcme();
    const res = (await handler('providers:save')({
      id: 'acme',
      apiKey: 'sk-acme',
    })) as ProviderSaveResponse;

    expect(res.errors).toEqual([]);
    expect(res.item.info.source).toBe('plugin');
    expect(res.item.status.hasApiKey).toBe(true);
    expect(secrets.get('provider:acme:apiKey')).toBe('sk-acme');
  });

  it('validates plugin provider config against the plugin configSchema on save', async () => {
    registerAcme();
    const res = (await handler('providers:save')({
      id: 'acme',
      apiKey: 'sk-acme',
      baseUrl: 'not a url',
    })) as ProviderSaveResponse;

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]!.path).toBe('baseUrl');
    expect(secrets.has('provider:acme:apiKey')).toBe(false);
  });

  it('tests a plugin provider via its factory once a key is stored', async () => {
    registerAcme();
    secrets.set('provider:acme:apiKey', 'sk-acme');

    const result = (await handler('providers:test')({ id: 'acme' })) as ProviderTestResult;

    expect(result.ok).toBe(true);
    expect(result.code).toBe('ok');
    expect(providerEntries.get('acme')?.lastTestResult).toEqual(result);
  });

  it('returns a config failure when testing a plugin provider without a key', async () => {
    registerAcme();
    const result = (await handler('providers:test')({ id: 'acme' })) as ProviderTestResult;

    expect(result.ok).toBe(false);
    expect(result.code).toBe('config');
    expect(result.message).toBe('No API key configured');
  });

  it('surfaces plugin provider failures from the test handler', async () => {
    registerAcme(async () => {
      throw new Error('acme backend unreachable');
    });
    secrets.set('provider:acme:apiKey', 'sk-acme');

    const result = (await handler('providers:test')({ id: 'acme' })) as ProviderTestResult;

    expect(result.ok).toBe(false);
    expect(result.message).toContain('acme backend unreachable');
  });

  it('deletes a plugin provider API key', async () => {
    registerAcme();
    secrets.set('provider:acme:apiKey', 'sk-acme');

    const item = (await handler('providers:delete')({ id: 'acme' })) as ProviderListItem;

    expect(secrets.has('provider:acme:apiKey')).toBe(false);
    expect(item.info.source).toBe('plugin');
    expect(item.status.hasApiKey).toBe(false);
  });

  it('still rejects ids that are neither catalog nor plugin providers', async () => {
    await expect(handler('providers:save')({ id: 'nope', apiKey: 'k' })).rejects.toThrow(
      /Unknown provider "nope"/,
    );
    await expect(handler('providers:delete')({ id: 'nope' })).rejects.toThrow(
      /Unknown provider "nope"/,
    );
    await expect(handler('providers:test')({ id: 'nope' })).rejects.toThrow(
      /Unknown provider "nope"/,
    );
  });
});
