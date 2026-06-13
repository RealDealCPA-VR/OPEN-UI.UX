import { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { ProviderConfig } from '@opencodex/core';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { deleteSecret, getSecret, setSecret } from '../storage/secrets';
import {
  clearSelectedModelEverywhere,
  deleteProviderEntry,
  getProviderEntry,
  setProviderEntry,
} from '../storage/settings';
import type { SelectedModel } from '../../shared/selected-model';
import type {
  ProviderConfigIssue,
  ProviderListItem,
  ProviderSaveResponse,
  ProviderStatus,
  ProviderTestResult,
} from '../../shared/provider-config';
import {
  buildProviderConfig,
  catalog,
  catalogById,
  getPluginProviderInfo,
  getProviderInfo,
  invalidateProviderInfo,
  type CatalogEntry,
} from './catalog';
import {
  getPluginProvider,
  listPluginProviders,
  type PluginProviderEntry,
} from './plugin-provider-registry';
import { ping } from './ping';

const apiKeyAccount = (id: string): string => `provider:${id}:apiKey`;

export const SELECTED_MODEL_TOAST_CHANNEL = 'selected-model:cleared';

interface ClearedToastPayload {
  removed: number;
  reason: 'model_missing';
  providerId: string;
}

function broadcastClearedToast(payload: ClearedToastPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(SELECTED_MODEL_TOAST_CHANNEL, payload);
  }
}

/**
 * After a provider's catalog gets re-fetched, walk every SelectedModel slot
 * (global, per-conversation, per-workspace) and clear the ones pointing at a
 * model id that no longer exists. Surfaces a renderer toast so the user can
 * notice their default was reset.
 */
export async function reconcileSelectedModelsForProvider(providerId: string): Promise<void> {
  const info = await getProviderInfo(providerId);
  if (!info) return;
  const known = new Set(info.models.map((m) => m.id));
  const result = clearSelectedModelEverywhere(
    (sel: SelectedModel) => sel.providerId === providerId && !known.has(sel.modelId),
  );
  if (result.removed > 0) {
    logger.info(
      { providerId, removed: result.removed },
      'selected-model entries cleared after catalog refresh',
    );
    broadcastClearedToast({ removed: result.removed, reason: 'model_missing', providerId });
  }
}

async function buildStatus(id: string): Promise<ProviderStatus> {
  const entry = getProviderEntry(id);
  const apiKey = await getSecret(apiKeyAccount(id));
  return {
    hasApiKey: apiKey !== null && apiKey.length > 0,
    baseUrl: entry.baseUrl,
    extra: entry.extra,
    lastTestedAt: entry.lastTestedAt,
    lastTestResult: entry.lastTestResult,
  };
}

async function buildItem(id: string): Promise<ProviderListItem | null> {
  const info = await getProviderInfo(id);
  if (info) return { info, status: await buildStatus(id) };
  const plugin = getPluginProvider(id);
  if (!plugin) return null;
  return { info: await getPluginProviderInfo(plugin), status: await buildStatus(id) };
}

type ResolvedProvider =
  | { kind: 'catalog'; entry: CatalogEntry }
  | { kind: 'plugin'; entry: PluginProviderEntry };

// providers:list surfaces plugin-contributed providers, so save/delete/test
// must resolve them too — otherwise they render in the UI but every attempt
// to configure them throws "Unknown provider".
function resolveProvider(id: string): ResolvedProvider {
  const entry = catalogById.get(id);
  if (entry) return { kind: 'catalog', entry };
  const plugin = getPluginProvider(id);
  if (plugin) return { kind: 'plugin', entry: plugin };
  throw new Error(`Unknown provider "${id}"`);
}

// Plugin providers declare no extraFields, so forward every stored extra and
// let the plugin's own configSchema decide what is valid.
function buildPluginProviderConfig(
  entry: PluginProviderEntry,
  input: { apiKey: string | undefined; baseUrl: string | null; extra: Record<string, string> },
): ProviderConfig {
  const raw: Record<string, unknown> = {};
  if (input.apiKey) raw['apiKey'] = input.apiKey;
  if (input.baseUrl) raw['baseUrl'] = input.baseUrl;
  for (const [key, value] of Object.entries(input.extra)) {
    if (value !== '') raw[key] = value;
  }
  return entry.factory.configSchema.parse(raw);
}

export function registerProviderHandlers(): void {
  registerInvoke('providers:list', z.void(), async () => {
    const items: ProviderListItem[] = [];
    for (const entry of catalog) {
      const item = await buildItem(entry.id);
      if (item) items.push(item);
    }
    for (const entry of listPluginProviders()) {
      items.push({ info: await getPluginProviderInfo(entry), status: await buildStatus(entry.id) });
    }
    return items;
  });

  registerInvoke(
    'providers:save',
    z.object({
      id: z.string(),
      apiKey: z.string().nullable().optional(),
      baseUrl: z.string().nullable().optional(),
      extra: z.record(z.string()).optional(),
    }),
    async (req): Promise<ProviderSaveResponse> => {
      const resolved = resolveProvider(req.id);

      const current = getProviderEntry(req.id);
      const existingKey = await getSecret(apiKeyAccount(req.id));

      const nextBaseUrl = req.baseUrl === undefined ? current.baseUrl : req.baseUrl || null;
      const nextExtra = req.extra ?? current.extra;
      const nextKey =
        req.apiKey === undefined
          ? existingKey
          : req.apiKey && req.apiKey.length > 0
            ? req.apiKey
            : null;

      try {
        const input = {
          apiKey: nextKey ?? undefined,
          baseUrl: nextBaseUrl,
          extra: nextExtra,
        };
        if (resolved.kind === 'catalog') buildProviderConfig(resolved.entry, input);
        else buildPluginProviderConfig(resolved.entry, input);
      } catch (err) {
        const errors: ProviderConfigIssue[] = [];
        if (err instanceof z.ZodError) {
          for (const issue of err.issues) {
            errors.push({ path: issue.path.join('.') || '(root)', message: issue.message });
          }
        } else {
          errors.push({
            path: '(root)',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        const item = await buildItem(req.id);
        if (!item) throw new Error(`Unknown provider "${req.id}"`);
        return { item, errors };
      }

      const apiKeyChanged = req.apiKey !== undefined && req.apiKey !== existingKey;
      if (req.apiKey !== undefined) {
        if (req.apiKey && req.apiKey.length > 0) {
          await setSecret(apiKeyAccount(req.id), req.apiKey);
        } else {
          await deleteSecret(apiKeyAccount(req.id));
        }
      }

      const patch: Parameters<typeof setProviderEntry>[1] = {
        baseUrl: nextBaseUrl,
        extra: nextExtra,
      };
      if (apiKeyChanged) {
        patch.lastTestResult = null;
        patch.lastTestedAt = null;
      }
      setProviderEntry(req.id, patch);

      invalidateProviderInfo(req.id);
      await reconcileSelectedModelsForProvider(req.id);
      const item = await buildItem(req.id);
      if (!item) throw new Error(`Unknown provider "${req.id}"`);
      logger.info({ id: req.id }, 'provider config saved');
      return { item, errors: [] };
    },
  );

  registerInvoke(
    'providers:delete',
    z.object({ id: z.string() }),
    async (req): Promise<ProviderListItem> => {
      resolveProvider(req.id);

      await deleteSecret(apiKeyAccount(req.id));
      deleteProviderEntry(req.id);
      invalidateProviderInfo(req.id);
      logger.info({ id: req.id }, 'provider config cleared');
      const item = await buildItem(req.id);
      if (!item) throw new Error(`Unknown provider "${req.id}"`);
      return item;
    },
  );

  registerInvoke(
    'providers:test',
    z.object({ id: z.string() }),
    async (req): Promise<ProviderTestResult> => {
      const resolved = resolveProvider(req.id);
      const stored = getProviderEntry(req.id);
      const apiKey = (await getSecret(apiKeyAccount(req.id))) ?? undefined;

      // Plugin providers are surfaced with requiresApiKey: true (see
      // getPluginProviderInfo), so testing them keeps the same gate.
      const requiresApiKey = resolved.kind === 'catalog' ? resolved.entry.requiresApiKey : true;
      if (requiresApiKey && !apiKey) {
        const result: ProviderTestResult = {
          ok: false,
          code: 'config',
          message: 'No API key configured',
        };
        setProviderEntry(req.id, {
          lastTestedAt: new Date().toISOString(),
          lastTestResult: result,
        });
        return result;
      }

      let result: ProviderTestResult;
      if (resolved.kind === 'catalog') {
        const spec = resolved.entry.buildPingSpec({
          apiKey,
          baseUrl: stored.baseUrl ?? undefined,
          extra: stored.extra,
        });
        result = await ping(spec);
      } else {
        result = await testPluginProvider(resolved.entry, {
          apiKey,
          baseUrl: stored.baseUrl,
          extra: stored.extra,
        });
      }
      setProviderEntry(req.id, {
        lastTestedAt: new Date().toISOString(),
        lastTestResult: result,
      });
      return result;
    },
  );
}

// Plugin providers expose no ping endpoint, so construct the provider with the
// stored config and list models — the closest generic reachability check the
// factory contract offers.
async function testPluginProvider(
  entry: PluginProviderEntry,
  input: { apiKey: string | undefined; baseUrl: string | null; extra: Record<string, string> },
): Promise<ProviderTestResult> {
  let config: ProviderConfig;
  try {
    config = buildPluginProviderConfig(entry, input);
  } catch (err) {
    return {
      ok: false,
      code: 'config',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const models = await entry.factory.create(config).listModels();
    return { ok: true, code: 'ok', message: `Provider responded with ${models.length} model(s)` };
  } catch (err) {
    return {
      ok: false,
      code: 'unknown',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
