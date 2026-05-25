import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { anthropicProvider } from './provider';

const FIXTURE_MESSAGES_STREAM = readFileSync(
  fileURLToPath(new URL('./__fixtures__/messages.txt', import.meta.url)),
  'utf8',
);

const STREAM_FIXTURE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","role":"assistant","usage":{"input_tokens":10,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
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

describe('anthropicProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams a chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = anthropicProvider.create({ apiKey: 'sk-ant-test' });
    const events: ChatEvent[] = await collect(
      provider.chat({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 3 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(64_000);
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('overloaded', { status: 529 }));

    const provider = anthropicProvider.create({ apiKey: 'sk-ant-test' });
    const events = await collect(
      provider.chat({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('sets x-api-key, anthropic-version, and anthropic-beta headers', async () => {
    const { calls } = stubFetch(() =>
      streamResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
    );

    const provider = anthropicProvider.create({
      apiKey: 'sk-ant-xxx',
      anthropicVersion: '2024-06-01',
      beta: ['prompt-caching-2024-07-31', 'fine-grained-tool-streaming-2025-05-14'],
    });
    await collect(provider.chat({ model: 'claude-sonnet-4-6', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-xxx');
    expect(headers['anthropic-version']).toBe('2024-06-01');
    expect(headers['anthropic-beta']).toBe(
      'prompt-caching-2024-07-31,fine-grained-tool-streaming-2025-05-14',
    );
  });

  it('defaults anthropic-version when not configured', async () => {
    const { calls } = stubFetch(() =>
      streamResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
    );

    const provider = anthropicProvider.create({ apiKey: 'sk-ant' });
    await collect(provider.chat({ model: 'claude-sonnet-4-6', messages: [] }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() =>
      streamResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
    );

    const provider = anthropicProvider.create({
      apiKey: 'sk-ant',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await collect(provider.chat({ model: 'claude-sonnet-4-6', messages: [] }));

    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/messages');
  });

  it('replays a recorded messages-stream fixture (text + tool_use + usage + done)', async () => {
    stubFetch(() => streamResponse(FIXTURE_MESSAGES_STREAM));

    const provider = anthropicProvider.create({ apiKey: 'sk-ant-test' });
    const events = await collect(
      provider.chat({
        model: 'claude-sonnet-4-6',
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
      id: 'toolu_1',
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

  it('throws from embed because Anthropic has no embeddings API', async () => {
    const provider = anthropicProvider.create({ apiKey: 'sk-ant' });
    await expect(provider.embed({ model: 'whatever', inputs: ['a'] })).rejects.toThrow(
      /embeddings/i,
    );
  });

  it('listModels and capabilities return known entries', async () => {
    const provider = anthropicProvider.create({ apiKey: 'sk-ant' });
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'claude-sonnet-4-6')).toBe(true);
    expect(await provider.capabilities('claude-opus-4-7')).toMatchObject({
      toolUse: true,
      vision: true,
      promptCaching: true,
    });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });
});
