import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerRegistry } from '@opencodex/core';
import { rmTmpSync } from '../../test/rm-tmp';

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
  },
}));

const storedPlugins: unknown[] = [];
const trustedKeys: { id: string; publicKey: string }[] = [];

vi.mock('../storage/settings', () => ({
  getStoredPlugins: () => storedPlugins,
  setStoredPlugins: (next: unknown[]) => {
    storedPlugins.splice(0, storedPlugins.length, ...next);
    return storedPlugins;
  },
  getTrustedPublisherKeys: () => trustedKeys,
  appendPluginConsent: (entry: unknown) => [entry],
}));

vi.mock('../logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

vi.mock('../tools/registry', () => {
  const tools = new Map<string, unknown>();
  return {
    getToolRegistry: () => ({
      has: (n: string) => tools.has(n),
      register: (t: { name: string }) => {
        tools.set(t.name, t);
      },
      unregister: (n: string) => {
        tools.delete(n);
      },
    }),
  };
});

function writePluginFixture(
  root: string,
  options: { withRunner: boolean; engineRange?: string },
): string {
  const dir = mkdtempSync(join(root, 'plugin-'));
  const manifest = {
    name: 'runner-plugin',
    version: '0.0.1',
    displayName: 'Runner Plugin',
    entry: 'index.mjs',
    engines: { opencodex: options.engineRange ?? '^0.1.0' },
    permissions: options.withRunner ? ['agent.runner'] : [],
    contributions: options.withRunner
      ? { runners: [{ id: 'echo', displayName: 'Echo Runner' }] }
      : {},
  };
  writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
  const entry = `
export default {
  async activate(host) {
    host.registerRunner({
      id: 'echo',
      displayName: 'Echo Runner',
      streaming: false,
      async *run() {
        yield { type: 'done', stopReason: 'end_turn' };
      },
    });
  },
};
`;
  writeFileSync(join(dir, 'index.mjs'), entry);
  return dir;
}

function writeToolPluginFixture(root: string, options: { permissions: string[] }): string {
  const dir = mkdtempSync(join(root, 'tool-plugin-'));
  const manifest = {
    name: 'tool-plugin',
    version: '0.0.1',
    displayName: 'Tool Plugin',
    entry: 'index.mjs',
    engines: { opencodex: '^0.1.0' },
    permissions: options.permissions,
    contributions: { tools: ['greet'] },
  };
  writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
  const entry = `
export default {
  async activate(host) {
    host.registerTool({
      name: 'greet',
      description: 'reads the workspace',
      inputZod: { parse: (v) => v },
      permissionTier: 'read',
      async execute() {
        return 'ok';
      },
    });
  },
};
`;
  writeFileSync(join(dir, 'index.mjs'), entry);
  return dir;
}

function writePanelPluginFixture(root: string, options: { permissions: string[] }): string {
  const dir = mkdtempSync(join(root, 'panel-plugin-'));
  const manifest = {
    name: 'panel-plugin',
    version: '0.0.1',
    displayName: 'Panel Plugin',
    entry: 'index.mjs',
    engines: { opencodex: '^0.1.0' },
    permissions: options.permissions,
    contributions: { panels: [{ id: 'main', title: 'Panel Plugin', entry: 'panel.html' }] },
  };
  writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() {} };\n');
  writeFileSync(join(dir, 'panel.html'), '<!doctype html><html><body>hi</body></html>\n');
  return dir;
}

function writeSlashPluginFixture(root: string): string {
  const dir = mkdtempSync(join(root, 'slash-plugin-'));
  const manifest = {
    name: 'slash-plugin',
    version: '0.0.1',
    displayName: 'Slash Plugin',
    entry: 'index.mjs',
    engines: { opencodex: '^0.1.0' },
    permissions: [],
    contributions: {},
  };
  writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
  const entry = `
export default {
  async activate(host) {
    host.registerSlashCommand('greet', async (args) => {
      globalThis.__slashGreetArgs = args;
    });
    host.registerSlashCommand('boom', async () => {
      throw new Error('boom');
    });
  },
};
`;
  writeFileSync(join(dir, 'index.mjs'), entry);
  return dir;
}

async function getRunnerRegistry(): Promise<RunnerRegistry> {
  const mod = await import('../agent/runner-registry-instance');
  return mod.runnerRegistry;
}

describe('plugin manager — runner contributions', () => {
  let workRoot = '';

  beforeEach(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'opencodex-plugins-'));
    storedPlugins.length = 0;
    trustedKeys.length = 0;
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
  });

  afterEach(async () => {
    const { shutdownAllPlugins } = await import('./manager');
    shutdownAllPlugins();
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
    rmTmpSync(workRoot);
  });

  it('without agent.runner permission, plugin stays pending-permissions and registers no runner', async () => {
    const { installPluginFromPath, listPlugins } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const item = listPlugins().find((p) => p.installPath === pluginPath);
    expect(item).toBeDefined();
    expect(item!.status).toBe('pending-permissions');
    expect(item!.registeredRunners).toEqual([]);
    const registry = await getRunnerRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it('granting agent.runner activates the plugin and surfaces the runner in the registry', async () => {
    const { installPluginFromPath, grantPermissions, listPlugins } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    await grantPermissions(id, ['agent.runner']);

    const item = listPlugins().find((p) => p.id === id)!;
    expect(item.status).toBe('loaded');
    const expectedRunnerId = `plugin__${id}__echo`;
    expect(item.registeredRunners).toEqual([expectedRunnerId]);
    const registry = await getRunnerRegistry();
    expect(registry.has(expectedRunnerId)).toBe(true);
    expect(registry.get(expectedRunnerId)!.displayName).toBe('Echo Runner');
  });

  it('disabling the plugin unregisters the runner', async () => {
    const { installPluginFromPath, grantPermissions, setPluginEnabled, listPlugins } =
      await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;
    await grantPermissions(id, ['agent.runner']);

    const runnerId = `plugin__${id}__echo`;
    const registry = await getRunnerRegistry();
    expect(registry.has(runnerId)).toBe(true);

    await setPluginEnabled(id, false);

    expect(registry.has(runnerId)).toBe(false);
    const item = listPlugins().find((p) => p.id === id)!;
    expect(item.registeredRunners).toEqual([]);
  });

  it('uninstalling the plugin unregisters the runner', async () => {
    const { installPluginFromPath, grantPermissions, uninstallPlugin } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;
    await grantPermissions(id, ['agent.runner']);

    const runnerId = `plugin__${id}__echo`;
    const registry = await getRunnerRegistry();
    expect(registry.has(runnerId)).toBe(true);

    await uninstallPlugin(id);

    expect(registry.has(runnerId)).toBe(false);
  });

  it('regranting permissions reloads the plugin without leaking runner registrations', async () => {
    const { installPluginFromPath, grantPermissions } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;
    await grantPermissions(id, ['agent.runner']);
    await grantPermissions(id, ['agent.runner']);

    const runnerId = `plugin__${id}__echo`;
    const registry = await getRunnerRegistry();
    expect(registry.list().filter((r) => r.id === runnerId)).toHaveLength(1);
  });

  it('refuses unsigned plugins without explicit acceptUnsigned consent', async () => {
    const { installPluginFromPath, UnsignedPluginRefusedError, listPlugins } =
      await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    await expect(installPluginFromPath(pluginPath)).rejects.toBeInstanceOf(
      UnsignedPluginRefusedError,
    );
    // Refused installs MUST NOT appear in the runtime — otherwise they're
    // pseudo-installed and `enable` would later activate them.
    expect(listPlugins().some((p) => p.installPath === pluginPath)).toBe(false);
  });

  it('refuses plugins whose engines.opencodex range excludes the host version', async () => {
    const sdk = await import('@opencodex/plugin-sdk');
    const { installPluginFromPath, listPlugins } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, {
      withRunner: false,
      engineRange: '^99.0.0',
    });
    await expect(
      installPluginFromPath(pluginPath, { acceptUnsigned: true }),
    ).rejects.toBeInstanceOf(sdk.EngineMismatchError);
    expect(listPlugins().some((p) => p.installPath === pluginPath)).toBe(false);
  });

  it('assigns a full UUID suffix to the runtime plugin id', async () => {
    const { installPluginFromPath } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: false });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const item = installed.find((p) => p.installPath === pluginPath);
    expect(item).toBeDefined();
    const suffix = item!.id.slice('runner-plugin-'.length);
    expect(suffix).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("rejects a 'read'-tier tool when the manifest grants no permission", async () => {
    const { installPluginFromPath, listPlugins } = await import('./manager');
    const pluginPath = writeToolPluginFixture(workRoot, { permissions: [] });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;
    const item = listPlugins().find((p) => p.id === id)!;
    expect(item.status).toBe('failed');
    expect(item.lastError).toContain('workspace.read');
    expect(item.registeredTools).toEqual([]);
  });

  it("registers a 'read'-tier tool once workspace.read is granted", async () => {
    const { installPluginFromPath, grantPermissions, listPlugins } = await import('./manager');
    const pluginPath = writeToolPluginFixture(workRoot, { permissions: ['workspace.read'] });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    // Declared-but-ungranted permission parks the plugin pending review.
    expect(listPlugins().find((p) => p.id === id)!.status).toBe('pending-permissions');

    await grantPermissions(id, ['workspace.read']);

    const item = listPlugins().find((p) => p.id === id)!;
    expect(item.status).toBe('loaded');
    expect(item.registeredTools).toEqual([`plugin__${id}__greet`]);
  });

  it('rejects granting permissions the manifest never declared', async () => {
    const { installPluginFromPath, grantPermissions, listPlugins } = await import('./manager');
    const pluginPath = writePluginFixture(workRoot, { withRunner: true });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    await expect(grantPermissions(id, ['agent.runner', 'shell.execute'])).rejects.toThrow(
      /shell\.execute/,
    );

    const item = listPlugins().find((p) => p.id === id)!;
    expect(item.grantedPermissions).toEqual([]);
    expect(item.status).toBe('pending-permissions');
  });

  it('omits panels from plugins that were never granted ui.panel', async () => {
    const { installPluginFromPath, listPanels, listPlugins } = await import('./manager');
    const pluginPath = writePanelPluginFixture(workRoot, { permissions: [] });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    // Zero declared permissions auto-activates — the panel must still be gated.
    expect(listPlugins().find((p) => p.id === id)!.status).toBe('loaded');
    expect(listPanels().filter((p) => p.pluginId === id)).toEqual([]);
  });

  it('serves panels once ui.panel is declared and granted', async () => {
    const { installPluginFromPath, grantPermissions, listPanels } = await import('./manager');
    const pluginPath = writePanelPluginFixture(workRoot, { permissions: ['ui.panel'] });
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    expect(listPanels().filter((p) => p.pluginId === id)).toEqual([]);

    await grantPermissions(id, ['ui.panel']);

    const panels = listPanels().filter((p) => p.pluginId === id);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe('main');
    expect(panels[0]!.htmlPath.endsWith('panel.html')).toBe(true);
  });
});

describe('plugin manager — slash command contributions', () => {
  let workRoot = '';

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'opencodex-plugins-slash-'));
    storedPlugins.length = 0;
    trustedKeys.length = 0;
    Reflect.deleteProperty(globalThis, '__slashGreetArgs');
  });

  afterEach(async () => {
    const { shutdownAllPlugins } = await import('./manager');
    shutdownAllPlugins();
    rmTmpSync(workRoot);
  });

  it('lists registered slash commands for loaded plugins with plugin id and name', async () => {
    const { installPluginFromPath, getPluginSlashCommands, listAllPluginSlashCommands } =
      await import('./manager');
    const pluginPath = writeSlashPluginFixture(workRoot);
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    expect(getPluginSlashCommands(id).map((c) => c.name)).toEqual(['greet', 'boom']);
    const refs = listAllPluginSlashCommands().filter((c) => c.pluginId === id);
    expect(refs).toEqual([
      { pluginId: id, pluginName: 'Slash Plugin', name: 'greet' },
      { pluginId: id, pluginName: 'Slash Plugin', name: 'boom' },
    ]);
  });

  it('omits slash commands once the plugin is disabled', async () => {
    const {
      installPluginFromPath,
      setPluginEnabled,
      getPluginSlashCommandHandler,
      listAllPluginSlashCommands,
    } = await import('./manager');
    const pluginPath = writeSlashPluginFixture(workRoot);
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    expect(getPluginSlashCommandHandler(id, 'greet')).toBeDefined();

    await setPluginEnabled(id, false);

    expect(listAllPluginSlashCommands().filter((c) => c.pluginId === id)).toEqual([]);
    expect(getPluginSlashCommandHandler(id, 'greet')).toBeUndefined();
  });

  it('returns a callable handler that receives the args string', async () => {
    const { installPluginFromPath, getPluginSlashCommandHandler } = await import('./manager');
    const pluginPath = writeSlashPluginFixture(workRoot);
    const installed = await installPluginFromPath(pluginPath, { acceptUnsigned: true });
    const id = installed.find((p) => p.installPath === pluginPath)!.id;

    const handler = getPluginSlashCommandHandler(id, 'greet');
    expect(handler).toBeDefined();
    await handler!('hello world');
    expect(Reflect.get(globalThis, '__slashGreetArgs')).toBe('hello world');

    expect(getPluginSlashCommandHandler(id, 'nope')).toBeUndefined();
    expect(getPluginSlashCommandHandler('not-a-plugin', 'greet')).toBeUndefined();
  });
});

describe('plugin manager — signature integrity', () => {
  let workRoot = '';

  beforeEach(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'opencodex-plugins-sig-'));
    storedPlugins.length = 0;
    trustedKeys.length = 0;
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
  });

  afterEach(async () => {
    const { shutdownAllPlugins } = await import('./manager');
    shutdownAllPlugins();
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
    rmTmpSync(workRoot);
  });

  function makeKeypair(): { privateKeyPem: string; publicKeyPem: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    };
  }

  // Zero-permission plugin whose activate is a no-op, so it auto-activates and
  // any non-'loaded' status comes from the integrity gate under test.
  function writeBenignFixture(root: string): string {
    const dir = mkdtempSync(join(root, 'benign-plugin-'));
    const manifest = {
      name: 'benign-plugin',
      version: '0.0.1',
      displayName: 'Benign Plugin',
      entry: 'index.mjs',
      engines: { opencodex: '^0.1.0' },
      permissions: [],
      contributions: {},
    };
    writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() {} };\n');
    return dir;
  }

  async function signFixture(dir: string): Promise<void> {
    const sdk = await import('@opencodex/plugin-sdk');
    const { privateKeyPem, publicKeyPem } = makeKeypair();
    const manifest = await sdk.readManifest(dir);
    const envelope = await sdk.signPluginDirectory(dir, manifest, privateKeyPem);
    writeFileSync(join(dir, 'opencodex.plugin.sig'), JSON.stringify(envelope));
    trustedKeys.push({ id: 'official', publicKey: publicKeyPem });
  }

  it('installs and loads a legitimately signed plugin without acceptUnsigned', async () => {
    const { installPluginFromPath } = await import('./manager');
    const dir = writeBenignFixture(workRoot);
    await signFixture(dir);
    const installed = await installPluginFromPath(dir);
    const item = installed.find((p) => p.installPath === dir)!;
    expect(item.status).toBe('loaded');
    expect(item.lastError).toBeUndefined();
  });

  it('quarantines a signed plugin whose entry file was tampered before install', async () => {
    const { installPluginFromPath, setPluginEnabled, listPlugins } = await import('./manager');
    const dir = writeBenignFixture(workRoot);
    await signFixture(dir);
    writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() { /* evil */ } };\n');
    const installed = await installPluginFromPath(dir);
    const item = installed.find((p) => p.installPath === dir)!;
    expect(item.status).toBe('tampered');
    expect(item.lastError).toMatch(/hash mismatch: index\.mjs/);
    // Toggling enable re-runs the integrity gate — it must never activate.
    await setPluginEnabled(item.id, false);
    await setPluginEnabled(item.id, true);
    expect(listPlugins().find((p) => p.id === item.id)!.status).toBe('tampered');
  });

  it('detects tampering of the entry file on the loadStoredPlugins path', async () => {
    const { installPluginFromPath, loadStoredPlugins, shutdownAllPlugins, listPlugins } =
      await import('./manager');
    const dir = writeBenignFixture(workRoot);
    await signFixture(dir);
    const installed = await installPluginFromPath(dir);
    expect(installed.find((p) => p.installPath === dir)!.status).toBe('loaded');

    shutdownAllPlugins();
    writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() { /* evil */ } };\n');
    await loadStoredPlugins();

    const item = listPlugins().find((p) => p.installPath === dir)!;
    expect(item.status).toBe('tampered');
    expect(item.lastError).toMatch(/hash mismatch: index\.mjs/);
  });

  it('fails closed on a trusted legacy manifest-only signature (no hash coverage)', async () => {
    const sdk = await import('@opencodex/plugin-sdk');
    const { installPluginFromPath } = await import('./manager');
    const dir = writeBenignFixture(workRoot);
    const { privateKeyPem, publicKeyPem } = makeKeypair();
    const manifest = await sdk.readManifest(dir);
    writeFileSync(join(dir, 'opencodex.plugin.sig'), sdk.signManifest(manifest, privateKeyPem));
    trustedKeys.push({ id: 'official', publicKey: publicKeyPem });
    const installed = await installPluginFromPath(dir);
    const item = installed.find((p) => p.installPath === dir)!;
    expect(item.status).toBe('tampered');
    expect(item.lastError).toMatch(/legacy manifest-only/);
  });

  it('keeps unsigned plugins working across restarts (sideload flow unchanged)', async () => {
    const { installPluginFromPath, loadStoredPlugins, shutdownAllPlugins, listPlugins } =
      await import('./manager');
    const dir = writeBenignFixture(workRoot);
    const installed = await installPluginFromPath(dir, { acceptUnsigned: true });
    expect(installed.find((p) => p.installPath === dir)!.status).toBe('loaded');

    shutdownAllPlugins();
    await loadStoredPlugins();

    expect(listPlugins().find((p) => p.installPath === dir)!.status).toBe('loaded');
  });

  it('treats an untrusted v2 signature as unsigned (requires acceptUnsigned, then loads)', async () => {
    const sdk = await import('@opencodex/plugin-sdk');
    const { installPluginFromPath, UnsignedPluginRefusedError } = await import('./manager');
    const dir = writeBenignFixture(workRoot);
    const attacker = makeKeypair();
    const manifest = await sdk.readManifest(dir);
    const envelope = await sdk.signPluginDirectory(dir, manifest, attacker.privateKeyPem);
    writeFileSync(join(dir, 'opencodex.plugin.sig'), JSON.stringify(envelope));
    const official = makeKeypair();
    trustedKeys.push({ id: 'official', publicKey: official.publicKeyPem });

    await expect(installPluginFromPath(dir)).rejects.toBeInstanceOf(UnsignedPluginRefusedError);

    const installed = await installPluginFromPath(dir, { acceptUnsigned: true });
    expect(installed.find((p) => p.installPath === dir)!.status).toBe('loaded');
  });
});
