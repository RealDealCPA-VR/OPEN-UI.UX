import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ManifestSchema, type PluginManifest } from './manifest';
import type { Plugin } from './plugin';

export class PluginLoadError extends Error {
  constructor(
    message: string,
    public readonly pluginPath: string,
  ) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

export async function readManifest(pluginPath: string): Promise<PluginManifest> {
  const manifestPath = join(pluginPath, 'opencodex.plugin.json');
  if (!existsSync(manifestPath)) {
    throw new PluginLoadError('opencodex.plugin.json not found', pluginPath);
  }
  const raw = await readFile(manifestPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PluginLoadError(
      `manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      pluginPath,
    );
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new PluginLoadError(`invalid manifest: ${result.error.message}`, pluginPath);
  }
  return result.data;
}

export async function loadPluginModule(
  pluginPath: string,
  manifest: PluginManifest,
): Promise<Plugin> {
  const entryPath = resolve(pluginPath, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new PluginLoadError(`entry point not found: ${manifest.entry}`, pluginPath);
  }
  const moduleUrl = pathToFileURL(entryPath).href;
  let mod: unknown;
  try {
    mod = await import(moduleUrl);
  } catch (err) {
    throw new PluginLoadError(
      `failed to import entry: ${err instanceof Error ? err.message : String(err)}`,
      pluginPath,
    );
  }
  const plugin = extractPlugin(mod);
  if (!plugin) {
    throw new PluginLoadError(
      'entry module must default-export a Plugin (use definePlugin)',
      pluginPath,
    );
  }
  return plugin;
}

function extractPlugin(mod: unknown): Plugin | null {
  if (!mod || typeof mod !== 'object') return null;
  const m = mod as Record<string, unknown>;
  const candidate = (m['default'] ?? m['plugin']) as Plugin | undefined;
  if (!candidate || typeof candidate.activate !== 'function') return null;
  return candidate;
}
