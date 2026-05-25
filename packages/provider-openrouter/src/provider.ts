import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import {
  buildChatRequestBody,
  chatChunkSchema,
  sseEvents,
  streamChunksToEvents,
  type ChatChunk,
} from '@opencodex/provider-openai';
import { openRouterConfigSchema, type OpenRouterConfig } from './config';
import { findModel, knownModels, parseOpenRouterModelsResponse } from './models';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';

  constructor(private readonly config: OpenRouterConfig) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req, { stream: true });
    const response = await this.post('/chat/completions', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      yield {
        type: 'error',
        message: `OpenRouter chat HTTP ${response.status}: ${detail}`,
        retryable: response.status >= 500 || response.status === 429,
      };
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    yield* streamChunksToEvents(this.chunksFromBody(response.body));
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new Error('OpenRouter does not provide a unified embeddings API');
  }

  async listModels(): Promise<ModelCapabilities[]> {
    if (!this.config.apiKey) return knownModels();
    try {
      const response = await this.get('/models');
      if (!response.ok) return knownModels();
      const raw: unknown = await response.json();
      const models = parseOpenRouterModelsResponse(raw);
      return models.length > 0 ? models : knownModels();
    } catch {
      return knownModels();
    }
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.referer) headers['http-referer'] = this.config.referer;
    if (this.config.title) headers['x-title'] = this.config.title;
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.buildHeaders() },
      body: JSON.stringify(body),
    };
    if (signal) init.signal = signal;
    return fetch(this.buildUrl(path), init);
  }

  private async get(path: string, signal?: AbortSignal): Promise<Response> {
    const init: RequestInit = {
      method: 'GET',
      headers: this.buildHeaders(),
    };
    if (signal) init.signal = signal;
    return fetch(this.buildUrl(path), init);
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unreadable body>';
    }
  }
}

export const openRouterProvider: ProviderFactory<OpenRouterConfig> = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  configSchema: openRouterConfigSchema,
  create(config) {
    return new OpenRouterProvider(config);
  },
};
