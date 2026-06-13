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
  assertValidApiKey,
  fetchWithRetry,
  mapHttpStatusToErrorCode,
  sanitizeErrorDetail,
} from '@opencodex/core';
import { googleConfigSchema, type GoogleConfig } from './config';
import { findModel, knownModels } from './models';
import { sseEvents } from './sse';
import { buildChatRequestBody } from './translate-request';
import { streamChunksToEvents } from './translate-stream';
import {
  batchEmbedContentsResponseSchema,
  streamChunkSchema,
  type StreamChunk,
} from './response-schemas';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_API_VERSION = 'v1beta';

class GoogleProvider implements LLMProvider {
  readonly id = 'google';
  readonly displayName = 'Google Gemini';

  constructor(private readonly config: GoogleConfig) {
    assertValidApiKey(config.apiKey, 'Google');
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req);
    const path = `/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
    const response = await this.post(path, body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      const code = mapHttpStatusToErrorCode(response.status);
      yield {
        type: 'error',
        message: `Google chat HTTP ${response.status}: ${detail}`,
        retryable:
          code === 'rate_limit' || code === 'server' || code === 'timeout' || code === 'network',
        code,
      };
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    yield* streamChunksToEvents(this.chunksFromBody(response.body), { model: req.model });
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const path = `/models/${encodeURIComponent(req.model)}:batchEmbedContents`;
    const body = {
      requests: req.inputs.map((text) => ({
        model: `models/${req.model}`,
        content: { parts: [{ text }] },
      })),
    };
    const response = await this.post(path, body, req.signal);
    if (!response.ok) {
      const detail = await this.safeReadText(response);
      throw new Error(`Google embeddings HTTP ${response.status}: ${detail}`);
    }
    const raw: unknown = await response.json();
    const parsed = batchEmbedContentsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Google embeddings: malformed response: ${parsed.error.message}`);
    }
    return {
      embeddings: parsed.data.embeddings.map((e) => e.values),
      usage: { tokens: 0 },
    };
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return knownModels();
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return findModel(model);
  }

  private async *chunksFromBody(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
    for await (const data of sseEvents(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const result = streamChunkSchema.safeParse(parsed);
      if (result.success) yield result.data;
    }
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const apiVersion = this.config.apiVersion ?? DEFAULT_API_VERSION;
    const url = `${base.replace(/\/$/, '')}/${apiVersion}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) headers['x-goog-api-key'] = this.config.apiKey;
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

export const googleProvider: ProviderFactory<GoogleConfig> = {
  id: 'google',
  displayName: 'Google Gemini',
  configSchema: googleConfigSchema,
  create(config) {
    return new GoogleProvider(config);
  },
};
