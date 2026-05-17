import type { ProviderFactory } from '@opencodex/core';

export const googleProvider: ProviderFactory = {
  id: 'google',
  displayName: 'Google Gemini',
  create(_config) {
    throw new Error('Not implemented — Phase 1 adapter task');
  },
};
