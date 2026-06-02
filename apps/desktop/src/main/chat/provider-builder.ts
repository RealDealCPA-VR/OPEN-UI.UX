import type { LLMProvider } from '@opencodex/core';
import { buildProviderConfig, catalogById } from '../providers/catalog';
import { getPluginProvider } from '../providers/plugin-provider-registry';
import { getSecret } from '../storage/secrets';
import { getProviderEntry } from '../storage/settings';

export class ProviderBuilderError extends Error {
  constructor(
    message: string,
    public readonly code: 'unknown_provider' | 'missing_api_key' | 'invalid_config',
  ) {
    super(message);
    this.name = 'ProviderBuilderError';
  }
}

export async function buildProviderForId(providerId: string): Promise<LLMProvider> {
  const entry = catalogById.get(providerId);
  if (!entry) {
    return buildPluginProviderForId(providerId);
  }
  const stored = getProviderEntry(providerId);
  const apiKey = (await getSecret(`provider:${providerId}:apiKey`)) ?? undefined;

  if (entry.requiresApiKey && !apiKey) {
    throw new ProviderBuilderError(
      `Provider "${entry.displayName}" requires an API key`,
      'missing_api_key',
    );
  }

  try {
    const config = buildProviderConfig(entry, {
      apiKey,
      baseUrl: stored.baseUrl,
      extra: stored.extra,
    });
    return entry.factory.create(config);
  } catch (err) {
    throw new ProviderBuilderError(
      err instanceof Error ? err.message : String(err),
      'invalid_config',
    );
  }
}

/**
 * Build a plugin-contributed provider (not in the static catalog). Config is
 * assembled generically from stored settings + keychain secret and validated by
 * the plugin's own `configSchema`, mirroring how catalog providers are built.
 */
async function buildPluginProviderForId(providerId: string): Promise<LLMProvider> {
  const pluginEntry = getPluginProvider(providerId);
  if (!pluginEntry) {
    throw new ProviderBuilderError(`Unknown provider "${providerId}"`, 'unknown_provider');
  }
  const apiKey = (await getSecret(`provider:${providerId}:apiKey`)) ?? undefined;
  const raw: Record<string, unknown> = {};
  if (apiKey) raw['apiKey'] = apiKey;
  try {
    const stored = getProviderEntry(providerId);
    if (stored.baseUrl) raw['baseUrl'] = stored.baseUrl;
    for (const [key, value] of Object.entries(stored.extra)) {
      if (value !== undefined && value !== '') raw[key] = value;
    }
  } catch {
    // No stored config for this plugin provider — build from defaults + key.
  }
  try {
    const config = pluginEntry.factory.configSchema.parse(raw);
    return pluginEntry.factory.create(config);
  } catch (err) {
    throw new ProviderBuilderError(
      err instanceof Error ? err.message : String(err),
      'invalid_config',
    );
  }
}
