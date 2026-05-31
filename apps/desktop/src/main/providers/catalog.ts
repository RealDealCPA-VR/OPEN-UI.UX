import { anthropicProvider } from '@opencodex/provider-anthropic';
import { googleProvider } from '@opencodex/provider-google';
import { mistralProvider } from '@opencodex/provider-mistral';
import { ollamaProvider } from '@opencodex/provider-ollama';
import { openAIProvider } from '@opencodex/provider-openai';
import { openRouterProvider } from '@opencodex/provider-openrouter';
import { xaiProvider } from '@opencodex/provider-xai';
import type { ModelCapabilities, ProviderConfig, ProviderFactory } from '@opencodex/core';
import type { ProviderExtraField, ProviderInfo } from '../../shared/provider-config';
import { getProviderEntry } from '../storage/settings';
import { getSecret } from '../storage/secrets';
import { loadOllamaModels } from '../ollama/ollama-probe';

export interface PingInput {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  extra: Record<string, string>;
}

export interface PingSpec {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  expectsAuth: boolean;
}

export interface CatalogEntry {
  id: string;
  displayName: string;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  extraFields: ProviderExtraField[];
  factory: ProviderFactory;
  loadModels(config: ProviderConfig): Promise<ModelCapabilities[]>;
  buildPingSpec(input: PingInput): PingSpec;
  /** When true, model info is never cached (re-fetched on every list) so a
   *  local daemon like Ollama always reflects its currently-pulled models. */
  dynamicModels?: boolean;
}

/*
 * TODO(v0.1): refresh this catalog from the live provider /models endpoints on
 * a cadence (or on demand) so we don't drift behind upstream model releases.
 * For v15 we keep the static list per provider because:
 *   1. /models endpoints require valid API keys, which we don't always have.
 *   2. Most providers' /models lists are noisy (legacy / unreleased entries).
 *   3. Capability metadata (context window, supports tools, supports vision)
 *      isn't returned, so we'd still need a curated map anyway.
 * Plan: add a `refreshCatalog()` IPC that fetches /models for any provider
 * with a configured + valid key, then merges live IDs into the curated
 * capabilities map. Tracked in the v0.1 backlog.
 */
const stripSlash = (s: string): string => s.replace(/\/$/, '');

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com';
const XAI_BASE = 'https://api.x.ai/v1';
const MISTRAL_BASE = 'https://api.mistral.ai/v1';
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function bearer(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export const catalog: CatalogEntry[] = [
  {
    id: openAIProvider.id,
    displayName: openAIProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: OPENAI_BASE,
    extraFields: [
      {
        name: 'organization',
        label: 'Organization ID',
        type: 'text',
        required: false,
        placeholder: 'org-...',
      },
      {
        name: 'project',
        label: 'Project ID',
        type: 'text',
        required: false,
        placeholder: 'proj_...',
      },
    ],
    factory: openAIProvider,
    loadModels: (config) =>
      openAIProvider.create(openAIProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl }) => ({
      url: `${stripSlash(baseUrl ?? OPENAI_BASE)}/models`,
      method: 'GET',
      headers: bearer(apiKey),
      expectsAuth: true,
    }),
  },
  {
    id: anthropicProvider.id,
    displayName: anthropicProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: ANTHROPIC_BASE,
    extraFields: [
      {
        name: 'anthropicVersion',
        label: 'API version',
        type: 'text',
        required: false,
        placeholder: '2023-06-01',
      },
      {
        name: 'beta',
        label: 'Beta header(s)',
        type: 'text',
        required: false,
        description: 'Comma-separated values sent in anthropic-beta',
      },
    ],
    factory: anthropicProvider,
    loadModels: (config) =>
      anthropicProvider.create(anthropicProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl, extra }) => ({
      url: `${stripSlash(baseUrl ?? ANTHROPIC_BASE)}/models`,
      method: 'GET',
      headers: {
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        'anthropic-version': extra['anthropicVersion'] ?? '2023-06-01',
      },
      expectsAuth: true,
    }),
  },
  {
    id: googleProvider.id,
    displayName: googleProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: GOOGLE_BASE,
    extraFields: [
      {
        name: 'apiVersion',
        label: 'API version',
        type: 'text',
        required: false,
        placeholder: 'v1beta',
      },
    ],
    factory: googleProvider,
    loadModels: (config) =>
      googleProvider.create(googleProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl, extra }) => {
      const version = extra['apiVersion'] ?? 'v1beta';
      const base = stripSlash(baseUrl ?? GOOGLE_BASE);
      const key = apiKey ?? '';
      return {
        url: `${base}/${version}/models${key ? `?key=${encodeURIComponent(key)}` : ''}`,
        method: 'GET',
        headers: {},
        expectsAuth: true,
      };
    },
  },
  {
    id: xaiProvider.id,
    displayName: xaiProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: XAI_BASE,
    extraFields: [],
    factory: xaiProvider,
    loadModels: (config) => xaiProvider.create(xaiProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl }) => ({
      url: `${stripSlash(baseUrl ?? XAI_BASE)}/models`,
      method: 'GET',
      headers: bearer(apiKey),
      expectsAuth: true,
    }),
  },
  {
    id: mistralProvider.id,
    displayName: mistralProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: MISTRAL_BASE,
    extraFields: [],
    factory: mistralProvider,
    loadModels: (config) =>
      mistralProvider.create(mistralProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl }) => ({
      url: `${stripSlash(baseUrl ?? MISTRAL_BASE)}/models`,
      method: 'GET',
      headers: bearer(apiKey),
      expectsAuth: true,
    }),
  },
  {
    id: ollamaProvider.id,
    displayName: ollamaProvider.displayName,
    requiresApiKey: false,
    defaultBaseUrl: OLLAMA_BASE,
    extraFields: [
      {
        name: 'keepAlive',
        label: 'Keep-alive',
        type: 'text',
        required: false,
        placeholder: '5m',
        description: 'How long the model stays loaded after a request (Ollama keep_alive)',
      },
    ],
    factory: ollamaProvider,
    dynamicModels: true,
    // Reflect what the local Ollama daemon has actually pulled (`/api/tags`).
    // The curated `listModels()` list is the fallback used when the daemon is
    // unreachable; live tags are matched back to curated families for their
    // capability metadata. See ollama-models.ts.
    loadModels: async (config) => {
      const staticModels = await ollamaProvider
        .create(ollamaProvider.configSchema.parse(config))
        .listModels();
      return loadOllamaModels(staticModels);
    },
    buildPingSpec: ({ baseUrl }) => ({
      url: `${stripSlash(baseUrl ?? OLLAMA_BASE)}/api/tags`,
      method: 'GET',
      headers: {},
      expectsAuth: false,
    }),
  },
  {
    id: openRouterProvider.id,
    displayName: openRouterProvider.displayName,
    requiresApiKey: true,
    defaultBaseUrl: OPENROUTER_BASE,
    extraFields: [
      {
        name: 'referer',
        label: 'HTTP-Referer',
        type: 'text',
        required: false,
        description: 'Sent as HTTP-Referer for OpenRouter dashboard attribution',
      },
      {
        name: 'title',
        label: 'X-Title',
        type: 'text',
        required: false,
        description: 'App name shown on the OpenRouter dashboard',
      },
    ],
    factory: openRouterProvider,
    loadModels: (config) =>
      openRouterProvider.create(openRouterProvider.configSchema.parse(config)).listModels(),
    buildPingSpec: ({ apiKey, baseUrl }) => ({
      url: `${stripSlash(baseUrl ?? OPENROUTER_BASE)}/auth/key`,
      method: 'GET',
      headers: bearer(apiKey),
      expectsAuth: true,
    }),
  },
];

export const catalogById: Map<string, CatalogEntry> = new Map(catalog.map((e) => [e.id, e]));

const apiKeyAccount = (id: string): string => `provider:${id}:apiKey`;

const infoCache: Map<string, ProviderInfo> = new Map();

export function invalidateProviderInfo(id?: string): void {
  if (id === undefined) infoCache.clear();
  else infoCache.delete(id);
}

async function resolveStoredConfig(entry: CatalogEntry): Promise<ProviderConfig> {
  let baseUrl: string | null = null;
  let extra: Record<string, string> = {};
  try {
    const stored = getProviderEntry(entry.id);
    baseUrl = stored.baseUrl;
    extra = stored.extra;
  } catch {
    // Settings store unavailable (e.g. vitest without electron) — fall back to defaults.
  }
  let apiKey: string | undefined;
  try {
    apiKey = (await getSecret(apiKeyAccount(entry.id))) ?? undefined;
  } catch {
    // Keytar unavailable — fall back to no key (listModels returns static list).
  }
  try {
    return buildProviderConfig(entry, { apiKey, baseUrl, extra });
  } catch {
    return entry.factory.configSchema.parse({});
  }
}

export async function getProviderInfo(id: string): Promise<ProviderInfo | undefined> {
  const entry = catalogById.get(id);
  if (!entry) return undefined;
  if (!entry.dynamicModels) {
    const cached = infoCache.get(id);
    if (cached) return cached;
  }
  const config = await resolveStoredConfig(entry);
  const info: ProviderInfo = {
    id: entry.id,
    displayName: entry.displayName,
    requiresApiKey: entry.requiresApiKey,
    defaultBaseUrl: entry.defaultBaseUrl,
    extraFields: entry.extraFields,
    models: await entry.loadModels(config),
  };
  if (!entry.dynamicModels) infoCache.set(id, info);
  return info;
}

export async function getAllProviderInfo(): Promise<ProviderInfo[]> {
  return Promise.all(
    catalog.map(async (e) => {
      const info = await getProviderInfo(e.id);
      if (!info) throw new Error(`Unreachable: catalog entry for ${e.id} missing info`);
      return info;
    }),
  );
}

export function buildProviderConfig(
  entry: CatalogEntry,
  input: { apiKey: string | undefined; baseUrl: string | null; extra: Record<string, string> },
): ProviderConfig {
  const raw: Record<string, unknown> = {};
  if (input.apiKey) raw['apiKey'] = input.apiKey;
  if (input.baseUrl) raw['baseUrl'] = input.baseUrl;
  for (const field of entry.extraFields) {
    const value = input.extra[field.name];
    if (value !== undefined && value !== '') raw[field.name] = value;
  }
  return entry.factory.configSchema.parse(raw);
}
