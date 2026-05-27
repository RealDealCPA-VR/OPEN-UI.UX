import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import {
  loadPluginModule,
  readManifest,
  type Permission,
  type Plugin,
  type PluginHost,
  type PluginLogger,
  type PluginManifest,
} from '@opencodex/plugin-sdk';
import type { ProviderFactory, SubagentRunner, Tool } from '@opencodex/core';
import type { PluginListItem, PluginPanelDescriptor, PluginStatus } from '../../shared/plugins';
import { runnerRegistry } from '../agent/runner-registry-instance';
import { logger } from '../logger';
import { getStoredPlugins, setStoredPlugins } from '../storage/settings';
import { getToolRegistry } from '../tools/registry';

interface RuntimeState {
  manifest: PluginManifest;
  installPath: string;
  enabled: boolean;
  grantedPermissions: Permission[];
  status: PluginStatus;
  lastError?: string;
  plugin?: Plugin;
  registeredTools: string[];
  registeredProviders: string[];
  registeredCommands: string[];
  registeredRunners: string[];
}

type StateListener = (plugins: PluginListItem[]) => void;

const runtime = new Map<string, RuntimeState>();
const listeners = new Set<StateListener>();

function pluginLogger(id: string): PluginLogger {
  return {
    info: (msg, meta) => logger.info({ pluginId: id, meta }, msg),
    warn: (msg, meta) => logger.warn({ pluginId: id, meta }, msg),
    error: (msg, meta) => logger.error({ pluginId: id, meta }, msg),
  };
}

function snapshot(): PluginListItem[] {
  const out: PluginListItem[] = [];
  for (const [id, r] of runtime.entries()) {
    out.push({
      id,
      manifest: r.manifest,
      installPath: r.installPath,
      enabled: r.enabled,
      status: r.status,
      grantedPermissions: r.grantedPermissions,
      registeredTools: r.registeredTools,
      registeredRunners: r.registeredRunners,
      ...(r.lastError ? { lastError: r.lastError } : {}),
    });
  }
  return out;
}

function emit(): void {
  const plugins = snapshot();
  for (const l of listeners) l(plugins);
}

export function listPlugins(): PluginListItem[] {
  return snapshot();
}

export function listPanels(): PluginPanelDescriptor[] {
  const out: PluginPanelDescriptor[] = [];
  for (const [id, r] of runtime.entries()) {
    if (r.status !== 'loaded') continue;
    const panels = r.manifest.contributions.panels;
    if (!panels) continue;
    for (const p of panels) {
      out.push({
        pluginId: id,
        id: p.id,
        title: p.title,
        htmlPath: resolvePath(r.installPath, p.entry),
      });
    }
  }
  return out;
}

export function onPluginsChange(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function checkPermission(id: string, required: Permission): void {
  const r = runtime.get(id);
  if (!r) throw new Error(`unknown plugin ${id}`);
  if (!r.grantedPermissions.includes(required)) {
    throw new Error(`plugin ${id} lacks permission ${required}`);
  }
}

function buildHost(id: string): PluginHost {
  return {
    pluginId: id,
    logger: pluginLogger(id),
    registerTool(tool: Tool) {
      const r = runtime.get(id);
      if (!r) return;
      const registry = getToolRegistry();
      const name = `plugin__${id}__${tool.name}`;
      if (registry.has(name)) {
        logger.warn({ pluginId: id, toolName: name }, 'plugin tool name collision');
        return;
      }
      registry.register({ ...tool, name });
      r.registeredTools.push(name);
    },
    registerProvider(provider: ProviderFactory) {
      const r = runtime.get(id);
      if (!r) return;
      // Providers from plugins are tracked but not auto-registered into the global provider registry
      // (that requires more wiring; for now we just record the intent).
      r.registeredProviders.push(provider.id);
      logger.info(
        { pluginId: id, providerId: provider.id },
        'plugin provider registered (tracked)',
      );
    },
    registerRunner(runner: SubagentRunner) {
      const r = runtime.get(id);
      if (!r) return;
      checkPermission(id, 'agent.runner');
      const name = `plugin__${id}__${runner.id}`;
      if (runnerRegistry.has(name)) {
        logger.warn({ pluginId: id, runnerName: name }, 'plugin runner name collision');
        return;
      }
      const wrapper: SubagentRunner = {
        ...runner,
        id: name,
        run: runner.run.bind(runner),
        ...(runner.checkInstalled ? { checkInstalled: runner.checkInstalled.bind(runner) } : {}),
      };
      runnerRegistry.register(wrapper);
      r.registeredRunners.push(name);
    },
    registerSlashCommand(name) {
      const r = runtime.get(id);
      if (!r) return;
      r.registeredCommands.push(name);
      logger.info({ pluginId: id, commandName: name }, 'plugin slash command registered (tracked)');
    },
    async getSetting(_key) {
      checkPermission(id, 'settings.read');
      return undefined;
    },
    async setSetting(_key, _value) {
      checkPermission(id, 'settings.write');
    },
  };
}

async function activatePlugin(id: string): Promise<void> {
  const r = runtime.get(id);
  if (!r) return;
  if (!r.enabled) {
    r.status = 'disabled';
    return;
  }
  const missing = r.manifest.permissions.filter((p) => !r.grantedPermissions.includes(p));
  if (missing.length > 0) {
    r.status = 'pending-permissions';
    return;
  }
  try {
    const plugin = await loadPluginModule(r.installPath, r.manifest);
    r.plugin = plugin;
    const host = buildHost(id);
    await plugin.activate(host);
    r.status = 'loaded';
    r.lastError = undefined;
  } catch (err) {
    r.status = 'failed';
    r.lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err, pluginId: id }, 'plugin activation failed');
  }
}

function deactivatePlugin(id: string): void {
  const r = runtime.get(id);
  if (!r) return;
  const registry = getToolRegistry();
  for (const toolName of r.registeredTools) registry.unregister(toolName);
  for (const runnerName of r.registeredRunners) runnerRegistry.unregister(runnerName);
  r.registeredTools = [];
  r.registeredProviders = [];
  r.registeredCommands = [];
  r.registeredRunners = [];
  try {
    void r.plugin?.deactivate?.();
  } catch (err) {
    logger.warn({ err, pluginId: id }, 'plugin deactivate threw');
  }
  r.plugin = undefined;
}

export async function loadStoredPlugins(): Promise<void> {
  const stored = getStoredPlugins();
  for (const entry of stored) {
    try {
      const manifest = await readManifest(entry.installPath);
      runtime.set(entry.id, {
        manifest,
        installPath: entry.installPath,
        enabled: entry.enabled,
        grantedPermissions: entry.grantedPermissions,
        status: 'disabled',
        registeredTools: [],
        registeredProviders: [],
        registeredCommands: [],
        registeredRunners: [],
      });
      if (entry.enabled) await activatePlugin(entry.id);
    } catch (err) {
      logger.warn({ err, pluginId: entry.id }, 'failed to load plugin manifest');
    }
  }
  emit();
}

export async function installPluginFromPath(installPath: string): Promise<PluginListItem[]> {
  const manifest = await readManifest(installPath);
  const id = `${manifest.name}-${randomUUID().slice(0, 8)}`;
  runtime.set(id, {
    manifest,
    installPath,
    enabled: true,
    grantedPermissions: manifest.permissions.length === 0 ? [...manifest.permissions] : [],
    status: 'pending-permissions',
    registeredTools: [],
    registeredProviders: [],
    registeredCommands: [],
    registeredRunners: [],
  });
  persist();
  if (manifest.permissions.length === 0) await activatePlugin(id);
  emit();
  return snapshot();
}

export async function grantPermissions(
  id: string,
  permissions: Permission[],
): Promise<PluginListItem[]> {
  const r = runtime.get(id);
  if (!r) throw new Error(`unknown plugin ${id}`);
  r.grantedPermissions = Array.from(new Set([...r.grantedPermissions, ...permissions]));
  persist();
  if (r.enabled) {
    deactivatePlugin(id);
    await activatePlugin(id);
  }
  emit();
  return snapshot();
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginListItem[]> {
  const r = runtime.get(id);
  if (!r) throw new Error(`unknown plugin ${id}`);
  r.enabled = enabled;
  persist();
  if (enabled) {
    await activatePlugin(id);
  } else {
    deactivatePlugin(id);
    r.status = 'disabled';
  }
  emit();
  return snapshot();
}

export async function uninstallPlugin(id: string): Promise<PluginListItem[]> {
  deactivatePlugin(id);
  runtime.delete(id);
  persist();
  emit();
  return snapshot();
}

function persist(): void {
  const entries = Array.from(runtime.entries()).map(([id, r]) => ({
    id,
    installPath: r.installPath,
    enabled: r.enabled,
    grantedPermissions: r.grantedPermissions,
  }));
  setStoredPlugins(entries);
}

export function shutdownAllPlugins(): void {
  for (const id of Array.from(runtime.keys())) deactivatePlugin(id);
  runtime.clear();
}
