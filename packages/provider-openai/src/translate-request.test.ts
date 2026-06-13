import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '@opencodex/core';
import { buildChatRequestBody, translateMessages, translateTools } from './translate-request';

const baseReq: ChatRequest = { model: 'o3-mini', messages: [{ role: 'user', content: 'hi' }] };

describe('buildChatRequestBody reasoning', () => {
  it('omits reasoning_effort when reasoning is unset', () => {
    expect(buildChatRequestBody(baseReq, { stream: false }).reasoning_effort).toBeUndefined();
  });
  it('maps reasoning:true to medium effort', () => {
    expect(
      buildChatRequestBody({ ...baseReq, reasoning: true }, { stream: false }).reasoning_effort,
    ).toBe('medium');
  });
  it('treats reasoning:false as off', () => {
    expect(
      buildChatRequestBody({ ...baseReq, reasoning: false }, { stream: false }).reasoning_effort,
    ).toBeUndefined();
  });
  it('passes an explicit effort through', () => {
    expect(
      buildChatRequestBody({ ...baseReq, reasoning: { effort: 'high' } }, { stream: false })
        .reasoning_effort,
    ).toBe('high');
  });
});

describe('translateMessages', () => {
  it('passes through string content', () => {
    expect(translateMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('translates text blocks', () => {
    expect(
      translateMessages([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]),
    ).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
  });

  it('translates image blocks to data URLs', () => {
    const out = translateMessages([
      { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }] },
    ]);
    expect(out[0]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });

  it('translates tool_use blocks to assistant tool_calls', () => {
    expect(
      translateMessages([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'call_1', name: 'grep', arguments: { q: 'x' } },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'calling' }],
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'grep', arguments: '{"q":"x"}' },
          },
        ],
      },
    ]);
  });

  it('serializes null tool_result output as "null" (not empty string)', () => {
    expect(
      translateMessages([
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'call_1', output: null }],
        },
      ]),
    ).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'null' }]);
  });

  it('serializes undefined tool_result output as empty string', () => {
    expect(
      translateMessages([
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'call_1', output: undefined }],
        },
      ]),
    ).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: '' }]);
  });

  it('flushes content before a tool_result and resumes after', () => {
    expect(
      translateMessages([
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'call_1', output: 'found 3 hits' },
            { type: 'text', text: 'thanks' },
          ],
        },
      ]),
    ).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: 'found 3 hits' },
      { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
    ]);
  });

  it('preserves an already-stringified tool_use arguments value', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a', name: 'fn', arguments: '{"raw":true}' }],
      },
    ]);
    expect(out[0]?.tool_calls?.[0]?.function.arguments).toBe('{"raw":true}');
  });

  it('attaches the last seen tool_use id to a string-content tool message', () => {
    expect(
      translateMessages([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_9', name: 'grep', arguments: { q: 'x' } }],
        },
        { role: 'tool', content: 'found 2 hits' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_9', type: 'function', function: { name: 'grep', arguments: '{"q":"x"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_9', content: 'found 2 hits' },
    ]);
  });

  it('downgrades a string-content tool message with no preceding tool_use to a user turn', () => {
    expect(translateMessages([{ role: 'tool', content: 'orphan output' }])).toEqual([
      { role: 'user', content: 'orphan output' },
    ]);
  });
});

describe('translateTools', () => {
  it('returns undefined when empty', () => {
    expect(translateTools(undefined)).toBeUndefined();
    expect(translateTools([])).toBeUndefined();
  });

  it('wraps as function tools', () => {
    expect(
      translateTools([
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          permissionTier: 'read',
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'Read a file',
          parameters: { type: 'object' },
        },
      },
    ]);
  });
});

describe('buildChatRequestBody', () => {
  it('sets stream and stream_options when streaming', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      { stream: true },
    );
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('forwards optional params only when set', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [], temperature: 0.7, maxTokens: 100 },
      { stream: false },
    );
    expect(body.temperature).toBe(0.7);
    expect(body.max_completion_tokens).toBe(100);
    expect(body.max_tokens).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.stop).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  it('emits the legacy max_tokens name when maxTokensParam requests it', () => {
    const body = buildChatRequestBody(
      { model: 'grok-4', messages: [], maxTokens: 100 },
      { stream: false, maxTokensParam: 'max_tokens' },
    );
    expect(body.max_tokens).toBe(100);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('skips temperature and top_p for catalog reasoning models', () => {
    const body = buildChatRequestBody(
      { model: 'o3-mini', messages: [], temperature: 0.7, topP: 0.9, maxTokens: 100 },
      { stream: false },
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.max_completion_tokens).toBe(100);
  });

  it('skips temperature and top_p for o-series models not in the catalog', () => {
    const body = buildChatRequestBody(
      { model: 'o4-mini', messages: [], temperature: 0.7, topP: 0.9 },
      { stream: false },
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it('omits tools when none provided or empty', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [], tools: [] },
      { stream: false },
    );
    expect(body.tools).toBeUndefined();
  });

  it('translates toolChoice string values to OpenAI shape', () => {
    expect(
      buildChatRequestBody({ model: 'gpt-4o', messages: [], toolChoice: 'auto' }, { stream: false })
        .tool_choice,
    ).toBe('auto');
    expect(
      buildChatRequestBody(
        { model: 'gpt-4o', messages: [], toolChoice: 'required' },
        { stream: false },
      ).tool_choice,
    ).toBe('required');
    expect(
      buildChatRequestBody({ model: 'gpt-4o', messages: [], toolChoice: 'none' }, { stream: false })
        .tool_choice,
    ).toBe('none');
  });

  it('translates named toolChoice to function selector', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [], toolChoice: { name: 'grep' } },
      { stream: false },
    );
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'grep' } });
  });

  it('translates responseFormat json_object', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [], responseFormat: { type: 'json_object' } },
      { stream: false },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('translates responseFormat json_schema with schema', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } } as const;
    const body = buildChatRequestBody(
      {
        model: 'gpt-4o',
        messages: [],
        responseFormat: { type: 'json_schema', name: 'Reply', schema },
      },
      { stream: false },
    );
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Reply', schema },
    });
  });
});
