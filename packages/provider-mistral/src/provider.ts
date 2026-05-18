import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { mistralConfigSchema, type MistralConfig } from './config';
import { findModel, knownModels } from './models';
import { sseEvents } from './sse';
import { buildChatRequestBody } from './translate-request';
import { streamChunksToEvents } from './translate-stream';
import { chatChunkSchema, embeddingsResponseSchema, type ChatChunk } from './response-schemas';

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';

class MistralProvider implements LLMProvider {
  readonly id = 'mistral';
  readonly displayName = 'Mistral';

  constructor(private readonly config: MistralConfig) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req, { stream: true });
    const response = await this.post('/chat/completions', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      yield {
        type: 'error',
        message: `Mistral chat HTTP ${response.status}: ${detail}`,
        retryable: response.status >= 500 || response.status === 429,
      };
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    yield* streamChunksToEvents(this.chunksFromBody(response.body));
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const response = await this.post(
      '/embeddings',
      { model: req.model, input: req.inputs },
      req.signal,
    );
    if (!response.ok) {
      const detail = await this.safeReadText(response);
      throw new Error(`Mistral embeddings HTTP ${response.status}: ${detail}`);
    }
    const raw: unknown = await response.json();
    const parsed = embeddingsResponseSchema.parse(raw);
    return {
      embeddings: parsed.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding),
      usage: { tokens: parsed.usage.total_tokens },
    };
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return knownModels();
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return findModel(model);
  }

  private async *chunksFromBody(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatChunk> {
    for await (const data of sseEvents(body)) {
      if (data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const result = chatChunkSchema.safeParse(parsed);
      if (result.success) yield result.data;
    }
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${base.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.headers) Object.assign(headers, this.config.headers);

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
    if (signal) init.signal = signal;
    return fetch(url, init);
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unreadable body>';
    }
  }
}

export const mistralProvider: ProviderFactory<MistralConfig> = {
  id: 'mistral',
  displayName: 'Mistral',
  configSchema: mistralConfigSchema,
  create(config) {
    return new MistralProvider(config);
  },
};
