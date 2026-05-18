import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { openRouterProvider } from './provider';

const STREAM_FIXTURE = [
  'data: {"id":"a","object":"chat.completion.chunk","model":"anthropic/claude-sonnet-4-6","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"anthropic/claude-sonnet-4-6","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"anthropic/claude-sonnet-4-6","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

function streamResponse(body: string, status = 200): Response {
  const encoded = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(encoded);
        c.close();
      },
    }),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(responder: (call: FetchCall) => Response): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls };
}

describe('openRouterProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = openRouterProvider.create({ apiKey: 'or-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({
        model: 'anthropic/claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 4, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = openRouterProvider.create({ apiKey: 'or-test' });
    const events = await collect(
      provider.chat({
        model: 'anthropic/claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('sets Authorization, HTTP-Referer, and X-Title headers from config', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openRouterProvider.create({
      apiKey: 'or-xxx',
      referer: 'https://opencodex.dev',
      title: 'OpenCodex',
    });
    await collect(provider.chat({ model: 'openai/gpt-4o', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer or-xxx');
    expect(headers['http-referer']).toBe('https://opencodex.dev');
    expect(headers['x-title']).toBe('OpenCodex');
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openRouterProvider.create({
      apiKey: 'or',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await collect(provider.chat({ model: 'openai/gpt-4o', messages: [] }));

    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('throws from embed because OpenRouter has no unified embeddings API', async () => {
    const provider = openRouterProvider.create({ apiKey: 'or' });
    await expect(provider.embed({ model: 'whatever', inputs: ['a'] })).rejects.toThrow(
      /unified embeddings api/i,
    );
  });

  it('listModels and capabilities return known entries with org/model IDs', async () => {
    const provider = openRouterProvider.create({ apiKey: 'or' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'anthropic/claude-opus-4-7')).toBe(true);
    expect(models.some((m) => m.id === 'google/gemini-2.5-flash')).toBe(true);
    expect(await provider.capabilities('anthropic/claude-sonnet-4-6')).toMatchObject({
      toolUse: true,
      vision: true,
    });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });

  it('forwards tools as OpenAI-style function tools in the request body', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openRouterProvider.create({ apiKey: 'or' });
    await collect(
      provider.chat({
        model: 'anthropic/claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'find files' }],
        tools: [
          {
            name: 'grep',
            description: 'search',
            inputSchema: { type: 'object' },
            permissionTier: 'read',
          },
        ],
      }),
    );

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'grep', description: 'search', parameters: { type: 'object' } },
      },
    ]);
  });
});
