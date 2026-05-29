import { z } from 'zod';
import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { assertValidApiKey, sanitizeErrorDetail } from '@opencodex/core';

const DEFAULT_BASE_URL = 'https://api.voyageai.com/v1';

export const voyageConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
});

export type VoyageConfig = z.infer<typeof voyageConfigSchema>;

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int().nonnegative(),
    }),
  ),
  usage: z.object({
    total_tokens: z.number().int().nonnegative(),
  }),
});

const VOYAGE_MODELS: ModelCapabilities[] = [
  {
    id: 'voyage-3',
    providerId: 'voyage',
    displayName: 'Voyage 3',
    contextWindow: 32_000,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
  {
    id: 'voyage-3-lite',
    providerId: 'voyage',
    displayName: 'Voyage 3 Lite',
    contextWindow: 32_000,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
  {
    id: 'voyage-code-3',
    providerId: 'voyage',
    displayName: 'Voyage Code 3',
    contextWindow: 32_000,
    toolUse: false,
    vision: false,
    streaming: false,
    embeddings: true,
  },
];

/**
 * Voyage AI is an embeddings-only provider. The chat() method on this class
 * exists only to satisfy the LLMProvider interface; calling it always throws
 * with a clear "embeddings-only" message. Consumers should route Voyage models
 * via the embed() endpoint exclusively.
 */
class VoyageProvider implements LLMProvider {
  readonly id = 'voyage';
  readonly displayName = 'Voyage AI';

  constructor(private readonly config: VoyageConfig) {
    assertValidApiKey(config.apiKey, 'Voyage');
  }

  // eslint-disable-next-line require-yield
  async *chat(_req: ChatRequest): AsyncIterable<ChatEvent> {
    throw new Error(
      'Voyage AI is embeddings-only — no chat endpoint. ' +
        'Use embed() instead, or route chat requests to a different provider.',
    );
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${base.replace(/\/$/, '')}/embeddings`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.headers) Object.assign(headers, this.config.headers);
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: req.model, input: req.inputs }),
    };
    if (req.signal) init.signal = req.signal;
    const response = await fetch(url, init);
    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(`Voyage embeddings HTTP ${response.status}: ${detail}`);
    }
    const raw: unknown = await response.json();
    const parsed = embeddingResponseSchema.parse(raw);
    return {
      embeddings: parsed.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding),
      usage: { tokens: parsed.usage.total_tokens },
    };
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return VOYAGE_MODELS;
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return VOYAGE_MODELS.find((m) => m.id === model);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return sanitizeErrorDetail(await response.text());
  } catch {
    return '<unreadable body>';
  }
}

export const voyageProvider: ProviderFactory<VoyageConfig> = {
  id: 'voyage',
  displayName: 'Voyage AI',
  configSchema: voyageConfigSchema,
  create(config) {
    return new VoyageProvider(config);
  },
};
