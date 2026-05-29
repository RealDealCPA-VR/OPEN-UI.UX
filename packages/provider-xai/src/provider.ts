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
  computeCostUsd,
  fetchWithRetry,
  sanitizeErrorDetail,
} from '@opencodex/core';
import {
  buildChatRequestBody,
  chatChunkSchema,
  sseEvents,
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
    const body = buildChatRequestBody(req, { stream: true });
    const response = await this.post('/chat/completions', body, req.signal);
    if (!response.ok || !response.body) {
      const detail = await this.safeReadText(response);
      yield {
        type: 'error',
        message: `xAI chat HTTP ${response.status}: ${detail}`,
        retryable: response.status >= 500 || response.status === 429,
      };
      yield { type: 'done', stopReason: 'error' };
      return;
    }
    yield* this.translateChunks(this.chunksFromBody(response.body), req.model);
  }

  private async *translateChunks(
    chunks: AsyncGenerator<ChatChunk>,
    model: string,
  ): AsyncGenerator<ChatEvent> {
    const pending = new Map<string, { id: string; name: string; args: string; order: number }>();
    let nextOrder = 0;
    let finish: string | null | undefined;
    const pricing = findModel(model)?.pricing;

    for await (const chunk of chunks) {
      if (chunk.usage) {
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
        const cost = computeCostUsd({
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
          ...(pricing ? { pricing } : {}),
        });
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
          ...(cost !== undefined ? { costUsd: cost } : {}),
        };
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) yield { type: 'text_delta', delta: delta.content };
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const key =
            tc.index !== undefined
              ? `idx:${String(tc.index)}`
              : tc.id !== undefined
                ? `id:${tc.id}`
                : undefined;
          if (key === undefined) continue;
          const cur = pending.get(key) ?? { id: '', name: '', args: '', order: nextOrder++ };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          pending.set(key, cur);
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const sorted = [...pending.values()].sort((a, b) => a.order - b.order);
    for (const call of sorted) {
      let parsed: unknown = {};
      if (call.args) {
        try {
          parsed = JSON.parse(call.args);
        } catch {
          parsed = call.args;
        }
      }
      yield { type: 'tool_call', id: call.id, name: call.name, arguments: parsed };
    }
    yield {
      type: 'done',
      stopReason:
        finish === 'tool_calls' || finish === 'function_call'
          ? 'tool_use'
          : finish === 'length'
            ? 'max_tokens'
            : 'end_turn',
    };
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
