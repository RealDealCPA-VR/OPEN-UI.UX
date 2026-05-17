import type { ProviderFactory } from '@opencodex/core';

export const xaiProvider: ProviderFactory = {
  id: 'xai',
  displayName: 'xAI Grok',
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
