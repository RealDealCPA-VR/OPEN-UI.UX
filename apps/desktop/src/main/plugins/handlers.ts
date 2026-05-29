import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { z } from 'zod';
import { PermissionSchema } from '@opencodex/plugin-sdk';
import { registerInvoke } from '../ipc/registry';
import {
  grantPermissions,
  installPluginFromPath,
  listPanels,
  listPlugins,
  loadStoredPlugins,
  onPluginsChange,
  setPluginEnabled,
  uninstallPlugin,
} from './manager';
import { getPluginRegistryUrl, setPluginRegistryUrl } from '../storage/settings';
import { toFriendlyError } from '../util/friendly-error';
import { PLUGIN_PRESETS } from './presets';
import { fetchPluginRegistry } from './registry-fetcher';
import { installFromRegistryUrl } from './registry-installer';

function resolveBundledPresetPath(presetId: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'plugins', presetId);
  }
  return resolve(app.getAppPath(), '../..', 'packages', presetId);
}

export function registerPluginHandlers(): void {
  registerInvoke('plugins:list', z.void(), () => ({ plugins: listPlugins() }));
  registerInvoke('plugins:list-panels', z.void(), () => ({ panels: listPanels() }));
  registerInvoke('plugins:list-presets', z.void(), () => [...PLUGIN_PRESETS]);
  registerInvoke(
    'plugins:install-preset',
    z.object({ presetId: z.string().min(1) }),
    async ({ presetId }) => {
      const preset = PLUGIN_PRESETS.find((p) => p.id === presetId);
      if (!preset) throw new Error(`Unknown preset: ${presetId}`);
      const installPath = resolveBundledPresetPath(presetId);
      if (!existsSync(installPath)) {
        throw new Error(
          `Bundled plugin files not found at ${installPath}. ` +
            `Run "pnpm --filter @opencodex/desktop build:plugins" (dev) or reinstall the app (packaged).`,
        );
      }
      try {
        return { plugins: await installPluginFromPath(installPath) };
      } catch (err) {
        throw toFriendlyError(err);
      }
    },
  );
  registerInvoke(
    'plugins:install-from-path',
    z.object({ path: z.string().min(1) }),
    async ({ path }) => {
      try {
        return { plugins: await installPluginFromPath(path) };
      } catch (err) {
        throw toFriendlyError(err);
      }
    },
  );
  registerInvoke('plugins:browse-and-install', z.void(), async () => {
    const result = await dialog.showOpenDialog({
      title: 'Pick a plugin directory',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { plugins: listPlugins(), canceled: true };
    }
    const path = result.filePaths[0];
    if (!path) return { plugins: listPlugins(), canceled: true };
    const plugins = await installPluginFromPath(path);
    return { plugins, canceled: false };
  });
  registerInvoke(
    'plugins:set-enabled',
    z.object({ id: z.string().min(1), enabled: z.boolean() }),
    async ({ id, enabled }) => ({ plugins: await setPluginEnabled(id, enabled) }),
  );
  registerInvoke(
    'plugins:grant-permissions',
    z.object({ id: z.string().min(1), permissions: z.array(PermissionSchema) }),
    async ({ id, permissions }) => ({ plugins: await grantPermissions(id, permissions) }),
  );
  registerInvoke('plugins:uninstall', z.object({ id: z.string().min(1) }), async ({ id }) => ({
    plugins: await uninstallPlugin(id),
  }));
  registerInvoke('plugins:get-registry-url', z.void(), () => ({ url: getPluginRegistryUrl() }));
  registerInvoke(
    'plugins:set-registry-url',
    z.object({ url: z.string().url().nullable() }),
    ({ url }) => ({ url: setPluginRegistryUrl(url) }),
  );
  registerInvoke('plugins:fetch-registry', z.void(), async () => {
    const url = getPluginRegistryUrl();
    if (!url) return { entries: [], error: 'no registry URL configured' };
    return fetchPluginRegistry(url);
  });
  registerInvoke(
    'plugins:install-from-registry',
    z.object({
      installUrl: z.string().url(),
      acceptUnsigned: z.boolean().optional(),
    }),
    async ({ installUrl, acceptUnsigned }) => {
      const req: { installUrl: string; acceptUnsigned?: boolean } = { installUrl };
      if (acceptUnsigned !== undefined) req.acceptUnsigned = acceptUnsigned;
      return installFromRegistryUrl(req);
    },
  );

  onPluginsChange((plugins) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('plugins:changed', { plugins });
    }
  });

  void loadStoredPlugins();
}
