import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { mapHttpStatusToErrorCode, sanitizeErrorDetail } from '@opencodex/core';
import { ollamaConfigSchema, type OllamaConfig } from './config';
import { findModel, knownModels } from './models';
import { ndjsonLines } from './ndjson';
import { buildChatRequestBody } from './translate-request';
import { streamChunksToEvents } from './translate-stream';
import { chatChunkSchema, embeddingsResponseSchema, type ChatChunk } from './response-schemas';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama (local)';

  constructor(private readonly config: OllamaConfig) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req, { stream: true, keepAlive: this.config.keepAlive });
    const response = await this.post('/api/chat', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      const code = mapHttpStatusToErrorCode(response.status);
      yield {
        type: 'error',
        message: `Ollama chat HTTP ${response.status}: ${detail}`,
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
    const response = await this.post(
      '/api/embed',
      { model: req.model, input: req.inputs },
      req.signal,
    );
    if (!response.ok) {
      const detail = await this.safeReadText(response);
      throw new Error(`Ollama embeddings HTTP ${response.status}: ${detail}`);
    }
    const raw: unknown = await response.json();
    const parsed = embeddingsResponseSchema.parse(raw);
    return {
      embeddings: parsed.embeddings,
      usage: { tokens: parsed.prompt_eval_count ?? 0 },
    };
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return knownModels();
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return findModel(model);
  }

  private async *chunksFromBody(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatChunk> {
    for await (const line of ndjsonLines(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
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
    return fetch(url, init);
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return sanitizeErrorDetail(await response.text());
    } catch {
      return '<unreadable body>';
    }
  }
}

export const ollamaProvider: ProviderFactory<OllamaConfig> = {
  id: 'ollama',
  displayName: 'Ollama (local)',
  configSchema: ollamaConfigSchema,
  create(config) {
    return new OllamaProvider(config);
  },
};
