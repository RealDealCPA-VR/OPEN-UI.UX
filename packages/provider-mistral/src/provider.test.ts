import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { mistralProvider } from './provider';

const STREAM_FIXTURE = [
  'data: {"id":"a","object":"chat.completion.chunk","model":"mistral-large-latest","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"mistral-large-latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}',
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

describe('mistralProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = mistralProvider.create({ apiKey: 'mst-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 4, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('mistral-large-latest');
    expect(body.stream_options).toBeUndefined();
  });

  it('handles a tool_call delivered in one chunk without an index field', async () => {
    const stream = [
      'data: {"id":"x","model":"mistral-large-latest","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"toolA","type":"function","function":{"name":"grep","arguments":"{\\"q\\":\\"foo\\"}"}}]},"finish_reason":null}]}',
      '',
      'data: {"id":"x","model":"mistral-large-latest","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":5}}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n');
    stubFetch(() => streamResponse(stream));

    const provider = mistralProvider.create({ apiKey: 'mst' });
    const events = await collect(
      provider.chat({ model: 'mistral-large-latest', messages: [{ role: 'user', content: 'go' }] }),
    );

    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'toolA',
      name: 'grep',
      arguments: { q: 'foo' },
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = mistralProvider.create({ apiKey: 'mst' });
    const events = await collect(
      provider.chat({
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('embeds and returns vectors sorted to match input order', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { object: 'embedding', embedding: [0.1, 0.2], index: 1 },
              { object: 'embedding', embedding: [0.3, 0.4], index: 0 },
            ],
            model: 'mistral-embed',
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const provider = mistralProvider.create({ apiKey: 'mst' });
    const result = await provider.embed({ model: 'mistral-embed', inputs: ['a', 'b'] });
    expect(result.embeddings).toEqual([
      [0.3, 0.4],
      [0.1, 0.2],
    ]);
    expect(result.usage.tokens).toBe(5);
  });

  it('sets Authorization header from config.apiKey', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = mistralProvider.create({ apiKey: 'mst-xxx' });
    await collect(provider.chat({ model: 'mistral-large-latest', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer mst-xxx');
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = mistralProvider.create({
      apiKey: 'mst',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await collect(provider.chat({ model: 'mistral-large-latest', messages: [] }));

    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('listModels and capabilities return known entries including the embed model', async () => {
    const provider = mistralProvider.create({ apiKey: 'mst' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'mistral-large-latest')).toBe(true);
    expect(models.some((m) => m.id === 'mistral-embed')).toBe(true);
    expect(await provider.capabilities('codestral-latest')).toMatchObject({
      toolUse: true,
      vision: false,
    });
    expect(await provider.capabilities('mistral-embed')).toMatchObject({ embeddings: true });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });

  it('forwards tools as OpenAI-style function tools in the request body', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = mistralProvider.create({ apiKey: 'mst' });
    await collect(
      provider.chat({
        model: 'mistral-large-latest',
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
