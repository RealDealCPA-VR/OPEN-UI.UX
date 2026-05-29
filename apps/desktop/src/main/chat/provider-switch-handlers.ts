import { registerInvoke } from '../ipc/registry';
import {
  estimateCostsAcrossProvidersRequestSchema,
  switchProviderRequestSchema,
} from '../../shared/provider-switch';
import type { ProviderListItem } from '../../shared/provider-config';
import { buildProviderConfig, catalog, getProviderInfo } from '../providers/catalog';
import { getProviderEntry } from '../storage/settings';
import { getSecret } from '../storage/secrets';
import { logger } from '../logger';
import { estimateCostsAcrossProviders } from './cost-comparison';
import { switchProvider } from './provider-switch';

const apiKeyAccount = (id: string): string => `provider:${id}:apiKey`;

async function listConfiguredProviders(): Promise<
  ReadonlyArray<{ info: ProviderListItem['info']; configured: boolean }>
> {
  const out: Array<{ info: ProviderListItem['info']; configured: boolean }> = [];
  for (const entry of catalog) {
    try {
      const info = await getProviderInfo(entry.id);
      if (!info) continue;
      const stored = getProviderEntry(entry.id);
      const apiKey = await getSecret(apiKeyAccount(entry.id));
      const hasKey = apiKey !== null && apiKey.length > 0;
      let configured = !entry.requiresApiKey || hasKey;
      if (configured) {
        try {
          buildProviderConfig(entry, {
            apiKey: apiKey ?? undefined,
            baseUrl: stored.baseUrl,
            extra: stored.extra,
          });
        } catch {
          configured = false;
        }
      }
      out.push({ info, configured });
    } catch (err) {
      logger.warn({ err, providerId: entry.id }, 'cost-comparison: skipping provider');
    }
  }
  return out;
}

export function registerProviderSwitchHandlers(): void {
  registerInvoke('chat:switch-provider', switchProviderRequestSchema, (req) => {
    return switchProvider({
      conversationId: req.conversationId,
      providerId: req.providerId,
      modelId: req.modelId,
      resendStrategy: req.resendStrategy,
    });
  });

  registerInvoke(
    'chat:estimate-costs-across-providers',
    estimateCostsAcrossProvidersRequestSchema,
    async (req) => {
      const providers = await listConfiguredProviders();
      return estimateCostsAcrossProviders(req.conversationId, { providers });
    },
  );
}
