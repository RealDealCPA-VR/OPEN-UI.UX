import { providerConfigSchema, type ProviderFactory } from '@opencodex/core';

export const ollamaProvider: ProviderFactory = {
  id: 'ollama',
  displayName: 'Ollama (local)',
  configSchema: providerConfigSchema,
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
