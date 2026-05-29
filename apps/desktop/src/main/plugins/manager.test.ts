import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerRegistry } from '@opencodex/core';

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
  },
}));

const storedPlugins: unknown[] = [];

vi.mock('../storage/settings', () => ({
  getStoredPlugins: () => storedPlugins,
  setStoredPlugins: (next: unknown[]) => {
    storedPlugins.splice(0, storedPlugins.length, ...next);
    return storedPlugins;
  },
  getTrustedPublisherKeys: () => [],
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

async function getRunnerRegistry(): Promise<RunnerRegistry> {
  const mod = await import('../agent/runner-registry-instance');
  return mod.runnerRegistry;
}

describe('plugin manager — runner contributions', () => {
  let workRoot = '';

  beforeEach(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'opencodex-plugins-'));
    storedPlugins.length = 0;
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
  });

  afterEach(async () => {
    const { shutdownAllPlugins } = await import('./manager');
    shutdownAllPlugins();
    const registry = await getRunnerRegistry();
    for (const r of registry.list()) registry.unregister(r.id);
    rmSync(workRoot, { recursive: true, force: true });
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
});
