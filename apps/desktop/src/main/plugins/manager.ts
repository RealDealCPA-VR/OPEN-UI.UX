import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import {
  EngineMismatchError,
  assertPluginProvider,
  assertPluginRunner,
  assertPluginTool,
  loadPluginModule,
  readManifest,
  satisfiesEngineRange,
  verifyManifest,
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
import {
  appendPluginConsent,
  getRunnerCliPath,
  getStoredPlugins,
  getTrustedPublisherKeys,
  setStoredPlugins,
} from '../storage/settings';
import { getToolRegistry } from '../tools/registry';
import {
  registerPluginProvider,
  unregisterPluginProvidersFor,
} from '../providers/plugin-provider-registry';

export const HOST_PLUGIN_ENGINE_VERSION = '0.1.0';

interface RegisteredProvider {
  id: string;
  displayName: string;
  factory: ProviderFactory;
}

interface RegisteredSlashCommand {
  name: string;
  handler: (args: string) => Promise<void>;
}

interface RuntimeState {
  manifest: PluginManifest;
  installPath: string;
  enabled: boolean;
  grantedPermissions: Permission[];
  status: PluginStatus;
  lastError?: string;
  plugin?: Plugin;
  registeredTools: string[];
  registeredProviders: RegisteredProvider[];
  registeredCommands: RegisteredSlashCommand[];
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

// Map a tool's permissionTier to the plugin manifest permission required to
// register it. A plugin without the matching permission is rejected at
// register time — without this, registerTool was an open gate while
// registerRunner already enforced `agent.runner`.
const TIER_TO_PERMISSION: Record<Tool['permissionTier'], Permission> = {
  read: 'workspace.read',
  write: 'workspace.write',
  execute: 'shell.execute',
  network: 'network.fetch',
};

function buildHost(id: string): PluginHost {
  return {
    pluginId: id,
    logger: pluginLogger(id),
    registerTool(tool: Tool) {
      const r = runtime.get(id);
      if (!r) return;
      assertPluginTool(tool);
      const requiredPerm = TIER_TO_PERMISSION[tool.permissionTier];
      checkPermission(id, requiredPerm);
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
      assertPluginProvider(provider);
      if (r.registeredProviders.some((p) => p.id === provider.id)) {
        logger.warn(
          { pluginId: id, providerId: provider.id },
          'plugin provider id collision; ignoring duplicate registration',
        );
        return;
      }
      r.registeredProviders.push({
        id: provider.id,
        displayName: provider.displayName,
        factory: provider,
      });
      registerPluginProvider({
        pluginId: id,
        id: provider.id,
        displayName: provider.displayName,
        factory: provider,
      });
      logger.info(
        { pluginId: id, providerId: provider.id },
        'plugin provider registered (buildProviderForId can now construct it via routing / spawn)',
      );
    },
    registerRunner(runner: SubagentRunner) {
      const r = runtime.get(id);
      if (!r) return;
      assertPluginRunner(runner);
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
    registerSlashCommand(name, handler) {
      const r = runtime.get(id);
      if (!r) return;
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('plugin slash command name must be a non-empty string');
      }
      if (typeof handler !== 'function') {
        throw new Error(`plugin slash command "${name}" handler must be a function`);
      }
      if (r.registeredCommands.some((c) => c.name === name)) {
        logger.warn(
          { pluginId: id, commandName: name },
          'plugin slash command name collision; ignoring duplicate registration',
        );
        return;
      }
      r.registeredCommands.push({ name, handler });
      logger.info(
        { pluginId: id, commandName: name },
        'plugin slash command registered (tracked, dispatcher wiring is a planned follow-up)',
      );
    },
    async getSetting(key) {
      checkPermission(id, 'settings.read');
      // The only host-backed setting a v1 runner plugin reads is its CLI path
      // override, which the Runners panel persists per exposed runner id (e.g.
      // `claude-code`). The plugin asks for it under a conventional `*CliPath`
      // key, so map that onto the plugin's contributed runner. Without this the
      // override the user types in the UI never reaches the runner.
      if (typeof key === 'string' && key.endsWith('CliPath')) {
        const r = runtime.get(id);
        const wrapped = r?.registeredRunners[0];
        if (wrapped) {
          const sep = wrapped.lastIndexOf('__');
          const bareId = sep >= 0 ? wrapped.slice(sep + 2) : wrapped;
          const cliPath = getRunnerCliPath(bareId);
          return (cliPath ?? undefined) as never;
        }
      }
      return undefined;
    },
    async setSetting(_key, _value) {
      checkPermission(id, 'settings.write');
    },
  };
}

export function getPluginProviderFactories(id: string): RegisteredProvider[] {
  const r = runtime.get(id);
  if (!r) return [];
  return [...r.registeredProviders];
}

export function getPluginSlashCommands(id: string): RegisteredSlashCommand[] {
  const r = runtime.get(id);
  if (!r) return [];
  return [...r.registeredCommands];
}

export interface PluginSlashCommandRef {
  pluginId: string;
  pluginName: string;
  name: string;
}

export function listAllPluginSlashCommands(): PluginSlashCommandRef[] {
  const out: PluginSlashCommandRef[] = [];
  for (const [id, r] of runtime.entries()) {
    if (r.status !== 'loaded') continue;
    for (const c of r.registeredCommands) {
      out.push({ pluginId: id, pluginName: r.manifest.displayName, name: c.name });
    }
  }
  return out;
}

export function getPluginSlashCommandHandler(
  pluginId: string,
  name: string,
): ((args: string) => Promise<void>) | undefined {
  const r = runtime.get(pluginId);
  if (!r || r.status !== 'loaded') return undefined;
  return r.registeredCommands.find((c) => c.name === name)?.handler;
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
  unregisterPluginProvidersFor(id);
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

async function readSignature(installPath: string): Promise<string | null> {
  const sigPath = join(installPath, 'opencodex.plugin.sig');
  if (!existsSync(sigPath)) return null;
  try {
    const raw = await readFile(sigPath, 'utf8');
    return raw.trim();
  } catch {
    return null;
  }
}

export interface InstallPluginOptions {
  // Allow installing a plugin whose manifest has no valid signature against
  // a trusted publisher key. MUST be set explicitly by the caller after
  // securing user consent — the installer no longer silently proceeds for
  // unsigned plugins. Until plugin sandboxing lands (see security-model.md →
  // Plugin sandbox), this flag is the operator's last line of defense against
  // running arbitrary code with full main-process privileges.
  acceptUnsigned?: boolean;
  // Grant the manifest's declared permissions immediately and activate the
  // plugin in one step, instead of parking it in `pending-permissions` until
  // the user grants them from the Plugins panel. Reserved for first-party
  // bundled presets — they ship inside the app, so the install click IS the
  // consent. Third-party installs leave this unset and keep the review-then-
  // grant flow described in security-model.md.
  autoGrantPermissions?: boolean;
}

export class UnsignedPluginRefusedError extends Error {
  constructor(public readonly pluginName: string) {
    super(
      `Refusing to install unsigned plugin "${pluginName}": no valid signature against any trusted publisher key. ` +
        'Pass acceptUnsigned: true after securing explicit user consent.',
    );
    this.name = 'UnsignedPluginRefusedError';
  }
}

export async function installPluginFromPath(
  installPath: string,
  options: InstallPluginOptions = {},
): Promise<PluginListItem[]> {
  const manifest = await readManifest(installPath);
  if (!satisfiesEngineRange(HOST_PLUGIN_ENGINE_VERSION, manifest.engines.opencodex)) {
    throw new EngineMismatchError(
      manifest.name,
      manifest.engines.opencodex,
      HOST_PLUGIN_ENGINE_VERSION,
    );
  }
  const signature = await readSignature(installPath);
  const trusted = getTrustedPublisherKeys();
  let signed = false;
  let signer: string | null = null;
  if (signature) {
    const result = verifyManifest(manifest, signature, trusted);
    if (result.ok && result.signer) {
      signed = true;
      signer = result.signer;
    } else {
      logger.warn(
        { pluginName: manifest.name, reason: result.reason },
        'plugin signature did not verify against any trusted publisher key',
      );
    }
  }
  if (!signed && !options.acceptUnsigned) {
    logger.warn(
      { pluginName: manifest.name },
      'refusing to install unsigned plugin without explicit acceptUnsigned consent',
    );
    throw new UnsignedPluginRefusedError(manifest.name);
  }
  appendPluginConsent({
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    signed,
    signer,
    installedAt: new Date().toISOString(),
    userAcceptedUnsigned: !signed,
  });
  const id = `${manifest.name}-${randomUUID()}`;
  const autoGrant = options.autoGrantPermissions === true;
  runtime.set(id, {
    manifest,
    installPath,
    enabled: true,
    grantedPermissions: autoGrant ? [...manifest.permissions] : [],
    status: 'pending-permissions',
    registeredTools: [],
    registeredProviders: [],
    registeredCommands: [],
    registeredRunners: [],
  });
  persist();
  if (autoGrant || manifest.permissions.length === 0) await activatePlugin(id);
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
