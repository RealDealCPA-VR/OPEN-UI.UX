import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { ollamaProvider } from './provider';

const FIXTURE_CHAT_STREAM = readFileSync(
  fileURLToPath(new URL('./__fixtures__/chat-stream.ndjson', import.meta.url)),
  'utf8',
);

const STREAM_FIXTURE = [
  '{"model":"llama3.1","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":"Hello"},"done":false}',
  '{"model":"llama3.1","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":" there"},"done":false}',
  '{"model":"llama3.1","created_at":"2026-01-01T00:00:00Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":4,"eval_count":2,"total_duration":1000}',
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
    { status, headers: { 'content-type': 'application/x-ndjson' } },
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

describe('ollamaProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams an NDJSON chat response into ChatEvents', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = ollamaProvider.create({});
    const events: ChatEvent[] = await collect(
      provider.chat({ model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] }),
    );

    expect(events).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(events).toContainEqual({ type: 'text_delta', delta: ' there' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 4, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('llama3.1');
  });

  it('translates a tool_call chunk (no id from Ollama) into a synthesized tool_call event', async () => {
    const stream = [
      '{"model":"qwen2.5","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"grep","arguments":{"q":"foo"}}}]},"done":false}',
      '{"model":"qwen2.5","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":7,"eval_count":3}',
      '',
    ].join('\n');
    stubFetch(() => streamResponse(stream));

    const provider = ollamaProvider.create({});
    const events = await collect(
      provider.chat({ model: 'qwen2.5', messages: [{ role: 'user', content: 'go' }] }),
    );

    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toMatchObject({
      type: 'tool_call',
      name: 'grep',
      arguments: { q: 'foo' },
    });
    expect(toolCall && 'id' in toolCall && toolCall.id).toMatch(/^call_\d+_grep$/);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('replays a recorded NDJSON fixture (text + tool_call + usage + done)', async () => {
    stubFetch(() => streamResponse(FIXTURE_CHAT_STREAM));

    const provider = ollamaProvider.create({});
    const events = await collect(
      provider.chat({
        model: 'llama3.1',
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
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toMatchObject({
      type: 'tool_call',
      name: 'grep',
      arguments: { q: 'foo' },
    });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 7 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));

    const provider = ollamaProvider.create({});
    const events = await collect(
      provider.chat({ model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: false });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('embeds and returns vectors in order from Ollamas embeddings array', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
            prompt_eval_count: 8,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const provider = ollamaProvider.create({});
    const result = await provider.embed({ model: 'nomic-embed-text', inputs: ['a', 'b'] });
    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.usage.tokens).toBe(8);
  });

  it('honors a custom baseUrl', async () => {
    const { calls } = stubFetch(() => streamResponse('{"done":true}\n'));

    const provider = ollamaProvider.create({ baseUrl: 'http://remote-ollama:11434' });
    await collect(provider.chat({ model: 'llama3.1', messages: [] }));

    expect(calls[0]?.url).toBe('http://remote-ollama:11434/api/chat');
  });

  it('sends keep_alive when configured', async () => {
    const { calls } = stubFetch(() => streamResponse('{"done":true}\n'));

    const provider = ollamaProvider.create({ keepAlive: '5m' });
    await collect(provider.chat({ model: 'llama3.1', messages: [] }));

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.keep_alive).toBe('5m');
  });

  it('listModels and capabilities return known entries including embed models', async () => {
    const provider = ollamaProvider.create({});
    const models = await provider.listModels();
    expect(models.some((m) => m.id === 'llama3.1')).toBe(true);
    expect(models.some((m) => m.id === 'nomic-embed-text')).toBe(true);
    expect(await provider.capabilities('qwen2.5-coder')).toMatchObject({ toolUse: true });
    expect(await provider.capabilities('mxbai-embed-large')).toMatchObject({ embeddings: true });
    expect(await provider.capabilities('definitely-not-a-real-model')).toBeUndefined();
  });

  it('forwards tools as OpenAI-style function tools in the request body', async () => {
    const { calls } = stubFetch(() => streamResponse('{"done":true}\n'));

    const provider = ollamaProvider.create({});
    await collect(
      provider.chat({
        model: 'llama3.1',
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
