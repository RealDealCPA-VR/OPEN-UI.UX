import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { openAIProvider } from './provider';

const CHAT_FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/chat-completions.txt', import.meta.url)),
  'utf8',
);

const STREAM_FIXTURE = [
  'data: {"id":"a","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}',
  '',
  'data: {"id":"a","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
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

function stubFetch(responder: (call: FetchCall) => Response): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls };
}

describe('openAIProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = openAIProvider.create({ apiKey: 'sk-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 3, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-4o');
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = openAIProvider.create({ apiKey: 'sk-test' });
    const events = await collect(
      provider.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
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
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const provider = openAIProvider.create({ apiKey: 'sk-test' });
    const result = await provider.embed({
      model: 'text-embedding-3-small',
      inputs: ['a', 'b'],
    });
    expect(result.embeddings).toEqual([
      [0.3, 0.4],
      [0.1, 0.2],
    ]);
    expect(result.usage.tokens).toBe(5);
  });

  it('sets Authorization, organization, and project headers', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openAIProvider.create({
      apiKey: 'sk-xxx',
      organization: 'org_1',
      project: 'proj_1',
    });
    await collect(provider.chat({ model: 'gpt-4o', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-xxx');
    expect(headers['openai-organization']).toBe('org_1');
    expect(headers['openai-project']).toBe('proj_1');
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openAIProvider.create({
      apiKey: 'sk',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await collect(provider.chat({ model: 'gpt-4o', messages: [] }));

    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('replays a recorded chat-completions fixture into the full ChatEvent sequence', async () => {
    stubFetch(() => streamResponse(CHAT_FIXTURE));

    const provider = openAIProvider.create({ apiKey: 'sk' });
    const events = await collect(
      provider.chat({
        model: 'gpt-4o',
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
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 12,
      outputTokens: 7,
      cachedInputTokens: 4,
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('listModels and capabilities return known entries', async () => {
    const provider = openAIProvider.create({ apiKey: 'sk' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'gpt-4o')).toBe(true);
    expect(await provider.capabilities('gpt-4o')).toMatchObject({
      toolUse: true,
      vision: true,
    });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });
});
