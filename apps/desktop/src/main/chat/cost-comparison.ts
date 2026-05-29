import type Database from 'better-sqlite3';
import type { ProviderInfo } from '../../shared/provider-config';
import type {
  EstimateCostsAcrossProvidersResponse,
  ProviderCostEstimate,
} from '../../shared/provider-switch';
import { getConversationUsage } from '../storage/conversations';

export interface CostComparisonContext {
  providers: ReadonlyArray<{ info: ProviderInfo; configured: boolean }>;
  db?: Database.Database;
}

interface TokensTotals {
  inputTokens: number;
  outputTokens: number;
}

function tokensFromUsage(conversationId: string, db?: Database.Database): TokensTotals {
  const usage = db
    ? getConversationUsage(conversationId, db)
    : getConversationUsage(conversationId);
  return {
    inputTokens: usage.totalInputTokens,
    outputTokens: usage.totalOutputTokens,
  };
}

export function estimateCostFromTokens(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPerMillion: number; outputPerMillion: number },
): number {
  const inCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return Math.max(0, inCost + outCost);
}

export function estimateCostsAcrossProviders(
  conversationId: string,
  ctx: CostComparisonContext,
): EstimateCostsAcrossProvidersResponse {
  const totals = tokensFromUsage(conversationId, ctx.db);

  const estimates: ProviderCostEstimate[] = [];
  for (const p of ctx.providers) {
    if (!p.configured) continue;
    for (const model of p.info.models) {
      if (model.embeddings) continue;
      if (!model.pricing) {
        estimates.push({
          providerId: p.info.id,
          providerName: p.info.displayName,
          modelId: model.id,
          modelName: model.displayName,
          estimatedCostUsd: 0,
          knownPricing: false,
        });
        continue;
      }
      const cost = estimateCostFromTokens(totals.inputTokens, totals.outputTokens, model.pricing);
      estimates.push({
        providerId: p.info.id,
        providerName: p.info.displayName,
        modelId: model.id,
        modelName: model.displayName,
        estimatedCostUsd: cost,
        knownPricing: true,
      });
    }
  }

  estimates.sort((a, b) => {
    if (a.knownPricing && !b.knownPricing) return -1;
    if (!a.knownPricing && b.knownPricing) return 1;
    return a.estimatedCostUsd - b.estimatedCostUsd;
  });

  return {
    conversationId,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    estimates,
  };
}
