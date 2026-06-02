import type { LLMProvider } from '@opencodex/core';
import { buildProviderForId } from '../chat/provider-builder';
import { getActiveRoutingPolicy } from '../routing/routing-store';
import { logger } from '../logger';
import type { EmbeddingPipelineConfig, EmbeddingProviderResolver } from './multi-workspace-indexer';

/**
 * Production embedding resolver for the RAG indexer.
 *
 * The active routing policy's `when: 'embedding'` rule decides which provider +
 * model performs embeddings (the routing presets default this to
 * `openai/text-embedding-3-small` or local `ollama/nomic-embed-text`). When no
 * policy is active, or it has no embedding rule, or the provider can't be built
 * (e.g. missing API key), this resolves to `null` and the indexer skips
 * embedding — same graceful degradation the indexer already expects.
 */
export class RoutingEmbeddingResolver implements EmbeddingProviderResolver {
  async resolve(): Promise<{
    provider: Pick<LLMProvider, 'embed'>;
    config: EmbeddingPipelineConfig;
  } | null> {
    let policy;
    try {
      policy = getActiveRoutingPolicy();
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'embedding resolver: routing policy lookup failed',
      );
      return null;
    }
    if (!policy) return null;

    const rule = policy.rules.find((r) => r.when === 'embedding');
    if (!rule) {
      logger.debug('embedding resolver: active routing policy has no embedding rule');
      return null;
    }

    const { providerId, modelId } = rule.use;
    try {
      const provider = await buildProviderForId(providerId);
      return { provider, config: { providerId, modelId } };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), providerId, modelId },
        'embedding resolver: could not build embedding provider; skipping reindex',
      );
      return null;
    }
  }
}
