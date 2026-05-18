import type { LLMProvider } from '@opencodex/core';
import { buildProviderConfig, catalogById } from '../providers/catalog';
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
    throw new ProviderBuilderError(`Unknown provider "${providerId}"`, 'unknown_provider');
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
