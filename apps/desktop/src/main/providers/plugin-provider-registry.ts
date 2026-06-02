import type { ProviderFactory } from '@opencodex/core';

/**
 * Global registry of provider factories contributed by plugins. The plugin
 * manager registers into this on `registerProvider` and clears a plugin's
 * entries on deactivate; `buildProviderForId` consults it as a fallback when a
 * provider id isn't in the static catalog, so plugin-contributed providers can
 * actually be constructed (and used via routing rules / spawn_subagent).
 */
export interface PluginProviderEntry {
  pluginId: string;
  id: string;
  displayName: string;
  factory: ProviderFactory;
}

const registry = new Map<string, PluginProviderEntry>();

export function registerPluginProvider(entry: PluginProviderEntry): void {
  registry.set(entry.id, entry);
}

export function unregisterPluginProvidersFor(pluginId: string): void {
  for (const [id, entry] of registry) {
    if (entry.pluginId === pluginId) registry.delete(id);
  }
}

export function getPluginProvider(id: string): PluginProviderEntry | undefined {
  return registry.get(id);
}

export function listPluginProviders(): PluginProviderEntry[] {
  return [...registry.values()];
}
