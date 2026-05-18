import Store from 'electron-store';
import { z } from 'zod';
import type { ProviderTestResult } from '../../shared/provider-config';
import type { SelectedModel } from '../../shared/selected-model';

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

const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  workspaceHistory: z.array(z.string()).default([]),
  activeWorkspace: z.string().nullable().default(null),
  providers: z.record(providerEntrySchema).default({}),
  selectedModel: selectedModelSchema.nullable().default(null),
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
