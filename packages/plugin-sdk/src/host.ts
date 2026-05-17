import type { ProviderFactory, Tool } from '@opencodex/core';

export interface PluginLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export interface PluginHost {
  readonly pluginId: string;
  readonly logger: PluginLogger;

  registerTool(tool: Tool): void;
  registerProvider(provider: ProviderFactory): void;
  registerSlashCommand(name: string, handler: (args: string) => Promise<void>): void;

  getSetting<T = unknown>(key: string): Promise<T | undefined>;
  setSetting<T = unknown>(key: string, value: T): Promise<void>;
}
