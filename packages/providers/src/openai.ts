import type { ProviderFactory } from '@opencodex/core';

export const openAIProvider: ProviderFactory = {
  id: 'openai',
  displayName: 'OpenAI',
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
