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
  registeredRunners: string[];
  lastError?: string;
}

export interface PluginPanelDescriptor {
  pluginId: string;
  id: string;
  title: string;
  htmlPath: string;
}

export interface PluginSlashCommandDescriptor {
  pluginId: string;
  pluginName: string;
  name: string;
  description?: string;
}

export type RunPluginSlashCommandRequest = { pluginId: string; name: string; args: string };
export type RunPluginSlashCommandResult = { ok: true } | { ok: false; error: string };

export type InstallPluginRequest = { path: string };
export type EnablePluginRequest = { id: string; enabled: boolean };
export type UninstallPluginRequest = { id: string };
export type GrantPluginPermissionsRequest = { id: string; permissions: Permission[] };
export type PluginsChangedEvent = { plugins: PluginListItem[] };
