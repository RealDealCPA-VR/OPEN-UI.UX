import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { assertValidApiKey, fetchWithRetry, sanitizeErrorDetail } from '@opencodex/core';
import {
  buildChatRequestBody,
  chatChunkSchema,
  httpErrorEvent,
  sseEvents,
  streamChunksToEvents,
  type ChatChunk,
} from '@opencodex/provider-openai';
import { xaiConfigSchema, type XAIConfig } from './config';
import { findModel, knownModels } from './models';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

class XAIProvider implements LLMProvider {
  readonly id = 'xai';
  readonly displayName = 'xAI Grok';

  constructor(private readonly config: XAIConfig) {
    assertValidApiKey(config.apiKey, 'xAI');
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req, { stream: true, maxTokensParam: 'max_tokens' });
    const response = await this.post('/chat/completions', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      yield httpErrorEvent(`xAI chat HTTP ${response.status}: ${detail}`, response.status);
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    const pricing = findModel(req.model)?.pricing;
    yield* streamChunksToEvents(this.chunksFromBody(response.body), pricing ? { pricing } : {});
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new Error('xAI does not provide an embeddings API');
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
    };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.headers) Object.assign(headers, this.config.headers);

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
    if (signal) init.signal = signal;
    return fetchWithRetry(() => fetch(url, init), signal ? { signal } : {});
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return sanitizeErrorDetail(await response.text());
    } catch {
      return '<unreadable body>';
    }
  }
}

export const xaiProvider: ProviderFactory<XAIConfig> = {
  id: 'xai',
  displayName: 'xAI Grok',
  configSchema: xaiConfigSchema,
  create(config) {
    return new XAIProvider(config);
  },
};
