import { providerConfigSchema, type ProviderFactory } from '@opencodex/core';

export const mistralProvider: ProviderFactory = {
  id: 'mistral',
  displayName: 'Mistral',
  configSchema: providerConfigSchema,
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
