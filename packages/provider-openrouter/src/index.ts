import { providerConfigSchema, type ProviderFactory } from '@opencodex/core';

export const openRouterProvider: ProviderFactory = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  configSchema: providerConfigSchema,
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
