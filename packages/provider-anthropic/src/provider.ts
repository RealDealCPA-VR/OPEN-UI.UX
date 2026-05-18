import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { anthropicConfigSchema, type AnthropicConfig } from './config';
import { findModel, knownModels } from './models';
import { sseEvents } from './sse';
import { buildChatRequestBody } from './translate-request';
import { streamEventsToChatEvents } from './translate-stream';
import { streamEventSchema, type StreamEvent } from './response-schemas';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_VERSION = '2023-06-01';

class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';

  constructor(private readonly config: AnthropicConfig) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    const body = buildChatRequestBody(req, { stream: true });
    const response = await this.post('/messages', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      yield {
        type: 'error',
        message: `Anthropic chat HTTP ${response.status}: ${detail}`,
        retryable: response.status >= 500 || response.status === 429,
      };
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    yield* streamEventsToChatEvents(this.eventsFromBody(response.body));
  }

  async embed(_req: EmbedRequest): Promise<EmbedResult> {
    throw new Error('Anthropic does not provide an embeddings API');
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return knownModels();
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    return findModel(model);
  }

  private async *eventsFromBody(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
    for await (const data of sseEvents(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const result = streamEventSchema.safeParse(parsed);
      if (result.success) yield result.data;
    }
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${base.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.config.anthropicVersion ?? DEFAULT_VERSION,
    };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    if (this.config.beta) {
      headers['anthropic-beta'] = Array.isArray(this.config.beta)
        ? this.config.beta.join(',')
        : this.config.beta;
    }
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

export const anthropicProvider: ProviderFactory<AnthropicConfig> = {
  id: 'anthropic',
  displayName: 'Anthropic',
  configSchema: anthropicConfigSchema,
  create(config) {
    return new AnthropicProvider(config);
  },
};
