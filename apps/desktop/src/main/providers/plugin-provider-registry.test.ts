import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import type { ProviderFactory } from '@opencodex/core';
import {
  getPluginProvider,
  listPluginProviders,
  registerPluginProvider,
  unregisterPluginProvidersFor,
} from './plugin-provider-registry';

function fakeFactory(id: string): ProviderFactory {
  return {
    id,
    displayName: id,
    configSchema: z.object({ apiKey: z.string().optional() }),
    create: () => {
      throw new Error('not used in this test');
    },
  } as unknown as ProviderFactory;
}

describe('plugin-provider-registry', () => {
  beforeEach(() => {
    for (const e of listPluginProviders()) unregisterPluginProvidersFor(e.pluginId);
  });

  it('registers and resolves a plugin provider by id', () => {
    registerPluginProvider({
      pluginId: 'p1',
      id: 'acme',
      displayName: 'Acme',
      factory: fakeFactory('acme'),
    });
    expect(getPluginProvider('acme')?.displayName).toBe('Acme');
    expect(listPluginProviders()).toHaveLength(1);
  });

  it('clears only the given plugin’s providers on unregister', () => {
    registerPluginProvider({
      pluginId: 'p1',
      id: 'a',
      displayName: 'A',
      factory: fakeFactory('a'),
    });
    registerPluginProvider({
      pluginId: 'p2',
      id: 'b',
      displayName: 'B',
      factory: fakeFactory('b'),
    });
    unregisterPluginProvidersFor('p1');
    expect(getPluginProvider('a')).toBeUndefined();
    expect(getPluginProvider('b')?.displayName).toBe('B');
  });

  it('returns undefined for unknown ids', () => {
    expect(getPluginProvider('nope')).toBeUndefined();
  });
});
