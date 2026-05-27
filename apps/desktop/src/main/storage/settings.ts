import Store from 'electron-store';
import { z } from 'zod';
import { type ApprovalPolicies, DEFAULT_TIER_POLICIES } from '../../shared/approvals';
import { mcpServerEntrySchema, type McpServerEntry } from '../../shared/mcp';
import { DEFAULT_MEMORY_CONFIG, memoryConfigSchema, type MemoryConfig } from '../../shared/memory';
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
  memory: memoryConfigSchema.default(DEFAULT_MEMORY_CONFIG),
  telemetryEnabled: z.boolean().default(false),
  telemetryApiKey: z.string().default(''),
  telemetryHost: z.string().url().nullable().default(null),
  crashReportingEnabled: z.boolean().default(false),
  crashReportingDsn: z.string().default(''),
  crashReportingEnvironment: z.string().default('production'),
  autoCheckForUpdates: z.boolean().default(false),
  schedulerEnabledInDev: z.boolean().default(false),
  schedulerListenerPort: z.number().int().min(1).max(65535).nullable().default(null),
  skillRegistryUrl: z.string().url().nullable().default(null),
  hoverHintsEnabled: z.boolean().default(true),
  runners: z
    .record(
      z.object({
        cliPath: z.string().optional(),
      }),
    )
    .default({}),
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

export function getMemoryConfig(): MemoryConfig {
  return getSettings().memory;
}

export function setMemoryConfig(config: MemoryConfig): MemoryConfig {
  const parsed = memoryConfigSchema.parse(config);
  const next = updateSettings({ memory: parsed });
  return next.memory;
}

export interface TelemetrySettings {
  enabled: boolean;
  apiKey: string;
  host: string | null;
}

export function getTelemetrySettings(): TelemetrySettings {
  const s = getSettings();
  return {
    enabled: s.telemetryEnabled,
    apiKey: s.telemetryApiKey,
    host: s.telemetryHost,
  };
}

export function setTelemetrySettings(patch: Partial<TelemetrySettings>): TelemetrySettings {
  const update: Partial<Settings> = {};
  if (patch.enabled !== undefined) update.telemetryEnabled = patch.enabled;
  if (patch.apiKey !== undefined) update.telemetryApiKey = patch.apiKey;
  if (patch.host !== undefined) update.telemetryHost = patch.host;
  const next = updateSettings(update);
  return {
    enabled: next.telemetryEnabled,
    apiKey: next.telemetryApiKey,
    host: next.telemetryHost,
  };
}

export interface CrashReportingSettings {
  enabled: boolean;
  dsn: string;
  environment: string;
}

export function getCrashReportingSettings(): CrashReportingSettings {
  const s = getSettings();
  return {
    enabled: s.crashReportingEnabled,
    dsn: s.crashReportingDsn,
    environment: s.crashReportingEnvironment,
  };
}

export function setCrashReportingSettings(
  patch: Partial<CrashReportingSettings>,
): CrashReportingSettings {
  const update: Partial<Settings> = {};
  if (patch.enabled !== undefined) update.crashReportingEnabled = patch.enabled;
  if (patch.dsn !== undefined) update.crashReportingDsn = patch.dsn;
  if (patch.environment !== undefined) update.crashReportingEnvironment = patch.environment;
  const next = updateSettings(update);
  return {
    enabled: next.crashReportingEnabled,
    dsn: next.crashReportingDsn,
    environment: next.crashReportingEnvironment,
  };
}

export function getAutoCheckForUpdates(): boolean {
  return getSettings().autoCheckForUpdates;
}

export function setAutoCheckForUpdates(value: boolean): boolean {
  const next = updateSettings({ autoCheckForUpdates: value });
  return next.autoCheckForUpdates;
}

export function getSchedulerEnabledInDev(): boolean {
  return getSettings().schedulerEnabledInDev;
}

export function setSchedulerEnabledInDev(value: boolean): boolean {
  const next = updateSettings({ schedulerEnabledInDev: value });
  return next.schedulerEnabledInDev;
}

export function getSchedulerListenerPort(): number | null {
  return getSettings().schedulerListenerPort;
}

export function setSchedulerListenerPort(port: number | null): number | null {
  const next = updateSettings({ schedulerListenerPort: port });
  return next.schedulerListenerPort;
}

export function getSkillRegistryUrl(): string | null {
  return getSettings().skillRegistryUrl;
}

export function setSkillRegistryUrl(url: string | null): string | null {
  const next = updateSettings({ skillRegistryUrl: url });
  return next.skillRegistryUrl;
}

export function getHoverHintsEnabled(): boolean {
  return getSettings().hoverHintsEnabled;
}

export function setHoverHintsEnabled(value: boolean): boolean {
  const next = updateSettings({ hoverHintsEnabled: value });
  return next.hoverHintsEnabled;
}

export function getRunnerCliPath(runnerId: string): string | null {
  const entry = getSettings().runners[runnerId];
  return entry?.cliPath ?? null;
}

export function setRunnerCliPath(runnerId: string, cliPath: string | null): void {
  const current = getSettings().runners;
  const next = { ...current };
  if (cliPath === null || cliPath.trim().length === 0) {
    if (!(runnerId in next)) return;
    delete next[runnerId];
  } else {
    next[runnerId] = { cliPath };
  }
  updateSettings({ runners: next });
}
