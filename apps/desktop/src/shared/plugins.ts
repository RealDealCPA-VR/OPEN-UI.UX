import type { Permission, PluginManifest } from '@opencodex/plugin-sdk';

export type PluginStatus = 'loaded' | 'failed' | 'disabled' | 'pending-permissions';

export interface PluginListItem {
  id: string;
  manifest: PluginManifest;
  installPath: string;
  enabled: boolean;
  status: PluginStatus;
  grantedPermissions: Permission[];
  registeredTools: string[];
  lastError?: string;
}

export interface PluginPanelDescriptor {
  pluginId: string;
  id: string;
  title: string;
  htmlPath: string;
}

export type InstallPluginRequest = { path: string };
export type EnablePluginRequest = { id: string; enabled: boolean };
export type UninstallPluginRequest = { id: string };
export type GrantPluginPermissionsRequest = { id: string; permissions: Permission[] };
export type PluginsChangedEvent = { plugins: PluginListItem[] };
