import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmTmpSync } from '../../test/rm-tmp';

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

function writePluginFixture(root: string): string {
  const dir = mkdtempSync(join(root, 'plugin-'));
  const manifest = {
    name: 'sample-plugin',
    version: '0.0.1',
    displayName: 'Sample',
    entry: 'index.mjs',
    engines: { opencodex: '^0.1.0' },
    permissions: [],
    contributions: {},
  };
  writeFileSync(join(dir, 'opencodex.plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() {} };');
  return dir;
}

describe('plugins:install-from-registry installer', () => {
  let workRoot = '';

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'opencodex-installer-'));
    storedPlugins.length = 0;
  });

  afterEach(async () => {
    const { shutdownAllPlugins } = await import('./manager');
    shutdownAllPlugins();
    rmTmpSync(workRoot);
  });

  it('installs unsigned plugin from a file:// URL when acceptUnsigned is true', async () => {
    const { installFromRegistryUrl } = await import('./registry-installer');
    const pluginDir = writePluginFixture(workRoot);
    const result = await installFromRegistryUrl({
      installUrl: pathToFileURL(pluginDir).href,
      acceptUnsigned: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugins.length).toBeGreaterThan(0);
      expect(result.plugins.some((p) => p.installPath === pluginDir)).toBe(true);
    }
  });

  it('returns reason=unsigned when the plugin is unsigned and consent has not been given', async () => {
    const { installFromRegistryUrl } = await import('./registry-installer');
    const pluginDir = writePluginFixture(workRoot);
    const result = await installFromRegistryUrl({
      installUrl: pathToFileURL(pluginDir).href,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsigned');
      if (result.reason === 'unsigned') {
        expect(result.pluginName).toBe('sample-plugin');
      }
    }
  });

  it('rejects URLs whose scheme we do not support', async () => {
    const { installFromRegistryUrl } = await import('./registry-installer');
    const result = await installFromRegistryUrl({
      installUrl: 'ftp://example.com/plugin.tgz',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'error') {
      expect(result.error).toMatch(/unsupported install URL scheme/);
    }
  });

  it('rejects http(s) URLs that do not look like tarballs', async () => {
    const { installFromRegistryUrl } = await import('./registry-installer');
    const result = await installFromRegistryUrl({
      installUrl: 'https://example.com/plugin.zip',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'error') {
      expect(result.error).toMatch(/only .tgz\/.tar.gz tarballs/);
    }
  });
});
