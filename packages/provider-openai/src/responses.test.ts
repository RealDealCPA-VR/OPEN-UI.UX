import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '@opencodex/core';
import { openAIProvider } from './provider';
import { buildResponsesRequestBody } from './responses';

const STREAM_FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/responses-api.txt', import.meta.url)),
  'utf8',
);

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

describe('responsesStream (OpenAI Responses API)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('emits text deltas, tool_call, usage, and done from a recorded SSE fixture', async () => {
    const { calls } = stubFetch(() => streamResponse(STREAM_FIXTURE));

    const provider = openAIProvider.create({ apiKey: 'sk-test', useResponsesApi: true });
    const events: ChatEvent[] = await collect(
      provider.chat({ model: 'gpt-5', messages: [{ role: 'user', content: 'find foo' }] }),
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

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(call?.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-5');
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'find foo' }] },
    ]);
  });

  it('keeps text-delta order and emits done end_turn when there is no tool call', async () => {
    const textOnly = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"one"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"-two"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":2}}}',
      '',
      '',
    ].join('\n');
    stubFetch(() => streamResponse(textOnly));

    const provider = openAIProvider.create({ apiKey: 'sk', useResponsesApi: true });
    const events = await collect(
      provider.chat({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
    );

    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas).toEqual([
      { type: 'text_delta', delta: 'one' },
      { type: 'text_delta', delta: '-two' },
    ]);
    expect(events).toContainEqual({ type: 'usage', inputTokens: 3, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('translates a response.failed event into an error + done(error)', async () => {
    const failed = [
      'event: response.failed',
      'data: {"type":"response.failed","error":{"type":"server_error","message":"backend exploded"}}',
      '',
      '',
    ].join('\n');
    stubFetch(() => streamResponse(failed));

    const provider = openAIProvider.create({ apiKey: 'sk', useResponsesApi: true });
    const events = await collect(
      provider.chat({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('yields an error event on non-2xx HTTP', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }));

    const provider = openAIProvider.create({ apiKey: 'sk', useResponsesApi: true });
    const events = await collect(
      provider.chat({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('hits /v1/responses with bearer/org/project headers when configured', async () => {
    const { calls } = stubFetch(() =>
      streamResponse(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ),
    );

    const provider = openAIProvider.create({
      apiKey: 'sk-xxx',
      organization: 'org_1',
      project: 'proj_1',
      useResponsesApi: true,
    });
    await collect(provider.chat({ model: 'gpt-5', messages: [] }));

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-xxx');
    expect(headers['openai-organization']).toBe('org_1');
    expect(headers['openai-project']).toBe('proj_1');
  });

  it('falls back to /chat/completions when useResponsesApi is false (default)', async () => {
    const { calls } = stubFetch(() => streamResponse('data: [DONE]\n\n'));

    const provider = openAIProvider.create({ apiKey: 'sk' });
    await collect(provider.chat({ model: 'gpt-4o', messages: [] }));

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('translates tool_use + tool_result blocks into function_call / function_call_output items', () => {
    const body = buildResponsesRequestBody(
      {
        model: 'gpt-5',
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'thinking' },
              { type: 'tool_use', id: 'call_1', name: 'grep', arguments: { q: 'foo' } },
            ],
          },
          {
            role: 'tool',
            content: [{ type: 'tool_result', toolUseId: 'call_1', output: 'match!' }],
          },
        ],
      },
      { stream: true },
    );

    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'thinking' }],
      },
      { type: 'function_call', call_id: 'call_1', name: 'grep', arguments: '{"q":"foo"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'match!' },
    ]);
  });

  it('forwards tools as flat Responses-API function tools', () => {
    const body = buildResponsesRequestBody(
      {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'go' }],
        tools: [
          {
            name: 'grep',
            description: 'search',
            inputSchema: { type: 'object' },
            permissionTier: 'read',
          },
        ],
      },
      { stream: true },
    );
    expect(body.tools).toEqual([
      { type: 'function', name: 'grep', description: 'search', parameters: { type: 'object' } },
    ]);
  });
});
