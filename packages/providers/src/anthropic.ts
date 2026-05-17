import type { ProviderFactory } from '@opencodex/core';

export const anthropicProvider: ProviderFactory = {
  id: 'anthropic',
  displayName: 'Anthropic',
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
