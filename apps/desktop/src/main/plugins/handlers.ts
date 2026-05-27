import { BrowserWindow, dialog } from 'electron';
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
import { PLUGIN_PRESETS } from './presets';

export function registerPluginHandlers(): void {
  registerInvoke('plugins:list', z.void(), () => ({ plugins: listPlugins() }));
  registerInvoke('plugins:list-panels', z.void(), () => ({ panels: listPanels() }));
  registerInvoke('plugins:list-presets', z.void(), () => [...PLUGIN_PRESETS]);
  registerInvoke(
    'plugins:install-from-path',
    z.object({ path: z.string().min(1) }),
    async ({ path }) => ({
      plugins: await installPluginFromPath(path),
    }),
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
    try {
      const response = await fetch(url);
      if (!response.ok) return { entries: [], error: `HTTP ${response.status}` };
      const data = await response.json();
      return { entries: Array.isArray(data) ? data : [], error: null };
    } catch (err) {
      return { entries: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  onPluginsChange((plugins) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('plugins:changed', { plugins });
    }
  });

  void loadStoredPlugins();
}
