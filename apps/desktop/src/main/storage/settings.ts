import Store from 'electron-store';
import { z } from 'zod';
import { type ApprovalPolicies, DEFAULT_TIER_POLICIES } from '../../shared/approvals';
import { mcpServerEntrySchema, type McpServerEntry } from '../../shared/mcp';
import { PermissionSchema } from '@opencodex/plugin-sdk';
import type { ProviderTestResult } from '../../shared/provider-config';
import type { SelectedModel } from '../../shared/selected-model';
import type { ThemePreference } from '../../shared/theme';
import { applyRemove, applySetActive, type WorkspaceState } from '../../shared/workspace';

const providerTestResultSchema: z.ZodType<ProviderTestResult> = z.object({
  code: z.enum(['ok', 'config', 'auth', 'http', 'network', 'timeout', 'unknown']),
  ok: z.boolean(),
  message: z.string(),
  httpStatus: z.number().int().optional(),
});

const providerEntrySchema = z.object({
  baseUrl: z.string().nullable().default(null),
  extra: z.record(z.string()).default({}),
  lastTestedAt: z.string().nullable().default(null),
  lastTestResult: providerTestResultSchema.nullable().default(null),
});

export type StoredProviderEntry = z.infer<typeof providerEntrySchema>;

const selectedModelSchema: z.ZodType<SelectedModel> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

const approvalPolicySchema = z.enum(['auto', 'prompt', 'deny']);

const approvalPoliciesSchema = z.object({
  tierDefaults: z
    .object({
      read: approvalPolicySchema,
      write: approvalPolicySchema,
      execute: approvalPolicySchema,
      network: approvalPolicySchema,
    })
    .default(DEFAULT_TIER_POLICIES),
  toolOverrides: z.record(approvalPolicySchema).default({}),
});

const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  workspaceHistory: z.array(z.string()).default([]),
  activeWorkspace: z.string().nullable().default(null),
  providers: z.record(providerEntrySchema).default({}),
  selectedModel: selectedModelSchema.nullable().default(null),
  approvals: approvalPoliciesSchema.default({
    tierDefaults: DEFAULT_TIER_POLICIES,
    toolOverrides: {},
  }),
  auditRetentionDays: z.number().int().min(1).max(36500).nullable().default(null),
  mcpServers: z.array(mcpServerEntrySchema).default([]),
  onboardingComplete: z.boolean().default(false),
  plugins: z
    .array(
      z.object({
        id: z.string(),
        installPath: z.string(),
        enabled: z.boolean().default(true),
        grantedPermissions: z.array(PermissionSchema).default([]),
      }),
    )
    .default([]),
  pluginRegistryUrl: z.string().url().nullable().default(null),
  readOnlyChatMode: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

const defaults = SettingsSchema.parse({});

export const settingsStore = new Store<Settings>({
  name: 'settings',
  defaults,
});

export function getSettings(): Settings {
  return SettingsSchema.parse(settingsStore.store);
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...settingsStore.store, ...patch });
  settingsStore.store = next;
  return next;
}

export function getProviderEntry(id: string): StoredProviderEntry {
  const all = getSettings().providers;
  return all[id] ?? providerEntrySchema.parse({});
}

export function setProviderEntry(
  id: string,
  patch: Partial<StoredProviderEntry>,
): StoredProviderEntry {
  const current = getProviderEntry(id);
  const next = providerEntrySchema.parse({ ...current, ...patch });
  const settings = getSettings();
  updateSettings({ providers: { ...settings.providers, [id]: next } });
  return next;
}

export function deleteProviderEntry(id: string): void {
  const settings = getSettings();
  if (!(id in settings.providers)) return;
  const next = { ...settings.providers };
  delete next[id];
  updateSettings({ providers: next });
}

export function getSelectedModel(): SelectedModel | null {
  return getSettings().selectedModel;
}

export function setSelectedModel(sel: SelectedModel | null): SelectedModel | null {
  const next = updateSettings({ selectedModel: sel });
  return next.selectedModel;
}

export function getApprovalPolicies(): ApprovalPolicies {
  return getSettings().approvals;
}

export function setApprovalPolicies(patch: ApprovalPolicies): ApprovalPolicies {
  const next = updateSettings({ approvals: patch });
  return next.approvals;
}

export function getTheme(): ThemePreference {
  return getSettings().theme;
}

export function setTheme(preference: ThemePreference): ThemePreference {
  const next = updateSettings({ theme: preference });
  return next.theme;
}

export function getAuditRetentionDays(): number | null {
  return getSettings().auditRetentionDays;
}

export function setAuditRetentionDays(days: number | null): number | null {
  const next = updateSettings({ auditRetentionDays: days });
  return next.auditRetentionDays;
}

export function getWorkspaceState(): WorkspaceState {
  const s = getSettings();
  return { active: s.activeWorkspace, history: s.workspaceHistory };
}

export function setActiveWorkspace(path: string): WorkspaceState {
  const result = applySetActive(getWorkspaceState(), path);
  const next = updateSettings({
    activeWorkspace: result.active,
    workspaceHistory: result.history,
  });
  return { active: next.activeWorkspace, history: next.workspaceHistory };
}

export function clearActiveWorkspace(): WorkspaceState {
  const next = updateSettings({ activeWorkspace: null });
  return { active: next.activeWorkspace, history: next.workspaceHistory };
}

export function removeWorkspaceFromHistory(path: string): WorkspaceState {
  const result = applyRemove(getWorkspaceState(), path);
  const next = updateSettings({
    activeWorkspace: result.active,
    workspaceHistory: result.history,
  });
  return { active: next.activeWorkspace, history: next.workspaceHistory };
}

export function getMcpServers(): McpServerEntry[] {
  return getSettings().mcpServers;
}

export function setMcpServers(servers: McpServerEntry[]): McpServerEntry[] {
  const next = updateSettings({ mcpServers: servers });
  return next.mcpServers;
}

export function getOnboardingComplete(): boolean {
  return getSettings().onboardingComplete;
}

export function setOnboardingComplete(value: boolean): boolean {
  const next = updateSettings({ onboardingComplete: value });
  return next.onboardingComplete;
}

export type StoredPluginEntry = Settings['plugins'][number];

export function getStoredPlugins(): StoredPluginEntry[] {
  return getSettings().plugins;
}

export function setStoredPlugins(plugins: StoredPluginEntry[]): StoredPluginEntry[] {
  const next = updateSettings({ plugins });
  return next.plugins;
}

export function getPluginRegistryUrl(): string | null {
  return getSettings().pluginRegistryUrl;
}

export function setPluginRegistryUrl(url: string | null): string | null {
  const next = updateSettings({ pluginRegistryUrl: url });
  return next.pluginRegistryUrl;
}

export function getReadOnlyChatMode(): boolean {
  return getSettings().readOnlyChatMode;
}

export function setReadOnlyChatMode(value: boolean): boolean {
  const next = updateSettings({ readOnlyChatMode: value });
  return next.readOnlyChatMode;
}
