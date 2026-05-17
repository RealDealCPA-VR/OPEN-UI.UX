import type { PluginHost } from './host';

export interface Plugin {
  activate(host: PluginHost): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
