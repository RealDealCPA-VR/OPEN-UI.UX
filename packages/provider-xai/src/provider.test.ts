import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { xaiProvider } from './provider';

const FIXTURE_CHAT_COMPLETIONS = readFileSync(
  fileURLToPath(new URL('./__fixtures__/chat-completions.txt', import.meta.url)),
  'utf8',
);

const STREAM_FIXTURE = [
  'data: {"id":"a","object":"chat.completion.chunk","model":"grok-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"grok-4","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"grok-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
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

describe('xaiProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = xaiProvider.create({ apiKey: 'xai-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({ model: 'grok-4', messages: [{ role: 'user', content: 'hi' }] }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 4, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.x.ai/v1/chat/completions');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('grok-4');
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = xaiProvider.create({ apiKey: 'xai-test' });
    const events = await collect(
      provider.chat({ model: 'grok-4', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('sets Authorization header from config.apiKey', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = xaiProvider.create({ apiKey: 'xai-xxx' });
    await collect(provider.chat({ model: 'grok-4', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer xai-xxx');
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = xaiProvider.create({
      apiKey: 'xai',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await collect(provider.chat({ model: 'grok-4', messages: [] }));

    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('replays a recorded chat-completions fixture proving the shared OpenAI helpers translate correctly with xAI URL/headers', async () => {
    const { calls } = stubFetch(() => streamResponse(FIXTURE_CHAT_COMPLETIONS));

    const provider = xaiProvider.create({ apiKey: 'xai-test' });
    const events = await collect(
      provider.chat({
        model: 'grok-4',
        messages: [{ role: 'user', content: 'find foo' }],
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

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Searching' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' now' });
    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'call_1',
      name: 'grep',
      arguments: { q: 'foo' },
    });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 7 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });

    expect(calls[0]?.url).toBe('https://api.x.ai/v1/chat/completions');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer xai-test');
  });

  it('throws from embed because xAI has no embeddings API', async () => {
    const provider = xaiProvider.create({ apiKey: 'xai' });
    await expect(provider.embed({ model: 'whatever', inputs: ['a'] })).rejects.toThrow(
      /does not provide an embeddings api/i,
    );
  });

  it('listModels and capabilities return known entries', async () => {
    const provider = xaiProvider.create({ apiKey: 'xai' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'grok-4')).toBe(true);
    expect(models.some((m) => m.id === 'grok-code-fast-1')).toBe(true);
    expect(await provider.capabilities('grok-4')).toMatchObject({
      toolUse: true,
      vision: true,
    });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });

  it('forwards tools as OpenAI-style function tools in the request body', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = xaiProvider.create({ apiKey: 'xai' });
    await collect(
      provider.chat({
        model: 'grok-4',
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
