import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { googleProvider } from './provider';

const FIXTURE_GENERATE_CONTENT = readFileSync(
  fileURLToPath(new URL('./__fixtures__/generate-content.txt', import.meta.url)),
  'utf8',
);

const STREAM_FIXTURE = [
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"index":0}]}',
  '',
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" there"}]},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":3,"totalTokenCount":13}}',
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

describe('googleProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = googleProvider.create({ apiKey: 'gk-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ type: 'usage', inputTokens: 10, outputTokens: 3 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
    );
    const body = JSON.parse(call?.init.body as string);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = googleProvider.create({ apiKey: 'gk-test' });
    const events = await collect(
      provider.chat({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('sets x-goog-api-key header from config.apiKey', async () => {
    const { calls } = stubFetch(() => streamResponse('data: {}\n\n'));

    const provider = googleProvider.create({ apiKey: 'gk-xxx' });
    await collect(provider.chat({ model: 'gemini-2.5-pro', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gk-xxx');
  });

  it('honors a custom baseUrl and apiVersion', async () => {
    const { calls } = stubFetch(() => streamResponse('data: {}\n\n'));

    const provider = googleProvider.create({
      apiKey: 'gk',
      baseUrl: 'https://proxy.example.com',
      apiVersion: 'v1',
    });
    await collect(provider.chat({ model: 'gemini-2.5-pro', messages: [] }));

    expect(calls[0]?.url).toBe(
      'https://proxy.example.com/v1/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
    );
  });

  it('replays a recorded generate-content fixture (text + functionCall + usage + done)', async () => {
    stubFetch(() => streamResponse(FIXTURE_GENERATE_CONTENT));

    const provider = googleProvider.create({ apiKey: 'gk-test' });
    const events = await collect(
      provider.chat({
        model: 'gemini-2.5-pro',
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
      id: 'call_xyz',
      name: 'grep',
      arguments: { q: 'foo' },
    });
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({
      type: 'usage',
      inputTokens: 12,
      outputTokens: 7,
      cachedInputTokens: 4,
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('throws from embed because Google embeddings are not implemented yet', async () => {
    const provider = googleProvider.create({ apiKey: 'gk' });
    await expect(provider.embed({ model: 'text-embedding-004', inputs: ['a'] })).rejects.toThrow(
      /not implemented/i,
    );
  });

  it('listModels and capabilities return known entries', async () => {
    const provider = googleProvider.create({ apiKey: 'gk' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'gemini-2.5-pro')).toBe(true);
    expect(await provider.capabilities('gemini-2.5-pro')).toMatchObject({
      toolUse: true,
      vision: true,
    });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });

  it('forwards tools as functionDeclarations in the request body', async () => {
    const { calls } = stubFetch(() => streamResponse('data: {}\n\n'));

    const provider = googleProvider.create({ apiKey: 'gk' });
    await collect(
      provider.chat({
        model: 'gemini-2.5-pro',
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
        functionDeclarations: [
          { name: 'grep', description: 'search', parameters: { type: 'object' } },
        ],
      },
    ]);
  });
});
