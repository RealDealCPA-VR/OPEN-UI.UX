import { afterEach, describe, expect, it } from 'vitest';
import { assertProviderHonorsAbort } from '@opencodex/core';
import type { LLMProvider } from '@opencodex/core';
import { openAIProvider } from './provider';
import { anthropicProvider } from '@opencodex/provider-anthropic';
import { googleProvider } from '@opencodex/provider-google';
import { mistralProvider } from '@opencodex/provider-mistral';
import { ollamaProvider } from '@opencodex/provider-ollama';
import { xaiProvider } from '@opencodex/provider-xai';

/**
 * Build a never-ending streaming Response whose body keeps emitting `chunk`
 * every 5ms until the request's AbortSignal fires, at which point the stream
 * errors with an AbortError. This lets us assert each provider tears the
 * stream down promptly when its ChatRequest signal is aborted.
 */
function infiniteStreamResponse(
  chunk: string,
  contentType: string,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let cancelled = false;
      const onAbort = (): void => {
        cancelled = true;
        try {
          controller.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // already errored or closed
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const pump = (): void => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          return;
        }
        setTimeout(pump, 5);
      };
      pump();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

function installStreamingFetch(chunk: string, contentType: string): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    const signal = init?.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      queueMicrotask(() => resolve(infiniteStreamResponse(chunk, contentType, signal)));
    });
  }) as typeof fetch;
}

const SSE = 'text/event-stream';
const NDJSON = 'application/x-ndjson';

const OPENAI_CHUNK =
  'data: {"id":"x","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"."},"finish_reason":null}]}\n\n';

const XAI_CHUNK =
  'data: {"id":"x","object":"chat.completion.chunk","model":"grok-4","choices":[{"index":0,"delta":{"content":"."},"finish_reason":null}]}\n\n';

const MISTRAL_CHUNK =
  'data: {"id":"x","object":"chat.completion.chunk","model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":"."},"finish_reason":null}]}\n\n';

const ANTHROPIC_CHUNK =
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"."}}\n\n';

const GOOGLE_CHUNK =
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"."}]},"index":0}]}\n\n';

const OLLAMA_CHUNK =
  '{"model":"llama3.1","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":"."},"done":false}\n';

interface AbortCase {
  name: string;
  contentType: string;
  chunk: string;
  make: () => LLMProvider;
  model: string;
}

const CASES: AbortCase[] = [
  {
    name: 'openAIProvider',
    contentType: SSE,
    chunk: OPENAI_CHUNK,
    make: () => openAIProvider.create({ apiKey: 'sk-test' }),
    model: 'gpt-4o',
  },
  {
    name: 'anthropicProvider',
    contentType: SSE,
    chunk: ANTHROPIC_CHUNK,
    make: () => anthropicProvider.create({ apiKey: 'sk-ant-test' }),
    model: 'claude-3-5-sonnet-latest',
  },
  {
    name: 'googleProvider',
    contentType: SSE,
    chunk: GOOGLE_CHUNK,
    make: () => googleProvider.create({ apiKey: 'gk-test' }),
    model: 'gemini-2.5-pro',
  },
  {
    name: 'mistralProvider',
    contentType: SSE,
    chunk: MISTRAL_CHUNK,
    make: () => mistralProvider.create({ apiKey: 'mst-test' }),
    model: 'mistral-large-latest',
  },
  {
    name: 'xaiProvider',
    contentType: SSE,
    chunk: XAI_CHUNK,
    make: () => xaiProvider.create({ apiKey: 'xai-test' }),
    model: 'grok-4',
  },
  {
    name: 'ollamaProvider',
    contentType: NDJSON,
    chunk: OLLAMA_CHUNK,
    make: () => ollamaProvider.create({}),
    model: 'llama3.1',
  },
];

describe('streaming providers honor the chat AbortSignal', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const c of CASES) {
    it(`${c.name} stops promptly when the chat AbortSignal fires`, async () => {
      installStreamingFetch(c.chunk, c.contentType);

      const result = await assertProviderHonorsAbort(() => c.make(), {
        chatRequest: { model: c.model },
      });

      expect(['done-cancelled', 'error-cancelled', 'abort-thrown']).toContain(result.outcome);
      expect(result.settledAfterMs).toBeLessThanOrEqual(500);
    });
  }
});
