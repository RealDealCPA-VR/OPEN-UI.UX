import { providerConfigSchema, type ProviderFactory } from '@opencodex/core';

export const anthropicProvider: ProviderFactory = {
  id: 'anthropic',
  displayName: 'Anthropic',
  configSchema: providerConfigSchema,
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
