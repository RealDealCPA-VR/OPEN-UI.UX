import { describe, expect, it } from 'vitest';
import { buildChatRequestBody, translateMessages, translateTools } from './translate-request';

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
    expect(body.max_tokens).toBe(100);
    expect(body.top_p).toBeUndefined();
    expect(body.stop).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  it('omits tools when none provided or empty', () => {
    const body = buildChatRequestBody(
      { model: 'gpt-4o', messages: [], tools: [] },
      { stream: false },
    );
    expect(body.tools).toBeUndefined();
  });
});
