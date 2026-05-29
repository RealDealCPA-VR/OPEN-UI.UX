import { describe, expect, it } from 'vitest';
import {
  buildChatRequestBody,
  extractSystem,
  translateMessages,
  translateTools,
} from './translate-request';

describe('extractSystem', () => {
  it('pulls system messages out of the conversation', () => {
    const { system, rest } = extractSystem([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ]);
    expect(system).toBe('be brief');
    expect(rest).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('joins multiple system messages with blank-line separator', () => {
    const { system } = extractSystem([
      { role: 'system', content: 'a' },
      { role: 'system', content: [{ type: 'text', text: 'b' }] },
      { role: 'user', content: 'hi' },
    ]);
    expect(system).toBe('a\n\nb');
  });

  it('returns empty system when none present', () => {
    const { system, rest } = extractSystem([{ role: 'user', content: 'hi' }]);
    expect(system).toBe('');
    expect(rest).toHaveLength(1);
  });
});

describe('translateMessages', () => {
  it('wraps string content into a text part with user role', () => {
    expect(translateMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
    ]);
  });

  it('maps assistant role to model', () => {
    expect(
      translateMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
    ]);
  });

  it('translates image blocks to inlineData parts', () => {
    expect(
      translateMessages([
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AAA' } }],
      },
    ]);
  });

  it('translates assistant tool_use into functionCall parts with parsed args', () => {
    expect(
      translateMessages([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'call_0_grep', name: 'grep', arguments: { q: 'x' } },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'calling' },
          { functionCall: { id: 'call_0_grep', name: 'grep', args: { q: 'x' } } },
        ],
      },
    ]);
  });

  it('parses stringified tool_use arguments back to a JSON object', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'f', arguments: '{"a":1}' }],
      },
    ]);
    expect(out[0]?.parts[0]).toEqual({ functionCall: { id: 't', name: 'f', args: { a: 1 } } });
  });

  it('rejects non-JSON tool_use argument strings with a clear error', () => {
    expect(() =>
      translateMessages([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'f', arguments: 'not-json' }],
        },
      ]),
    ).toThrow(/JSON object/i);
  });

  it('rejects non-object tool_use arguments with a clear error', () => {
    expect(() =>
      translateMessages([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'f', arguments: 42 }],
        },
      ]),
    ).toThrow(/JSON object/i);
  });

  it('emits tool role as user role with functionResponse parts and looks up name from prior tool_use', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'grep', arguments: { q: 'x' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tool_1', output: 'found 3 hits' }],
      },
    ]);
    expect(out[1]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'tool_1',
            name: 'grep',
            response: { result: 'found 3 hits' },
          },
        },
      ],
    });
  });

  it('passes through object tool_result outputs as the response payload', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'grep', arguments: {} }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tool_1', output: { matches: 3 } }],
      },
    ]);
    expect(out[1]?.parts[0]).toEqual({
      functionResponse: { id: 'tool_1', name: 'grep', response: { matches: 3 } },
    });
  });

  it('marks tool errors under an error key when isError is set', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'grep', arguments: {} }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tool_1', output: 'boom', isError: true }],
      },
    ]);
    expect(out[1]?.parts[0]).toEqual({
      functionResponse: { id: 'tool_1', name: 'grep', response: { error: 'boom' } },
    });
  });

  it('falls back to toolUseId as name when no prior tool_use is found', () => {
    const out = translateMessages([
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'mystery', output: 'data' }],
      },
    ]);
    expect(out[0]?.parts[0]).toEqual({
      functionResponse: { id: 'mystery', name: 'mystery', response: { result: 'data' } },
    });
  });

  it('drops empty user messages instead of emitting empty parts', () => {
    expect(translateMessages([{ role: 'user', content: '' }])).toEqual([]);
  });
});

describe('translateTools', () => {
  it('returns undefined when empty', () => {
    expect(translateTools(undefined)).toBeUndefined();
    expect(translateTools([])).toBeUndefined();
  });

  it('wraps tools in a single functionDeclarations array', () => {
    expect(
      translateTools([
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          permissionTier: 'read',
        },
        {
          name: 'write',
          description: 'Write a file',
          inputSchema: { type: 'object' },
          permissionTier: 'write',
        },
      ]),
    ).toEqual([
      {
        functionDeclarations: [
          { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
          { name: 'write', description: 'Write a file', parameters: { type: 'object' } },
        ],
      },
    ]);
  });
});

describe('buildChatRequestBody', () => {
  it('packs system into systemInstruction.parts', () => {
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('omits systemInstruction when no system message present', () => {
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.systemInstruction).toBeUndefined();
  });

  it('forwards generationConfig options only when set', () => {
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [],
      temperature: 0.5,
      topP: 0.9,
      maxTokens: 1024,
      stop: ['END'],
    });
    expect(body.generationConfig).toEqual({
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 1024,
      stopSequences: ['END'],
    });
  });

  it('omits generationConfig when no options are set', () => {
    const body = buildChatRequestBody({ model: 'gemini-2.5-pro', messages: [] });
    expect(body.generationConfig).toBeUndefined();
  });

  it('omits tools when none provided or empty', () => {
    const body = buildChatRequestBody({ model: 'gemini-2.5-pro', messages: [], tools: [] });
    expect(body.tools).toBeUndefined();
  });

  it('maps toolChoice to toolConfig.functionCallingConfig mode', () => {
    expect(
      buildChatRequestBody({
        model: 'gemini-2.5-pro',
        messages: [],
        toolChoice: 'auto',
      }).toolConfig,
    ).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
    expect(
      buildChatRequestBody({
        model: 'gemini-2.5-pro',
        messages: [],
        toolChoice: 'required',
      }).toolConfig,
    ).toEqual({ functionCallingConfig: { mode: 'ANY' } });
    expect(
      buildChatRequestBody({
        model: 'gemini-2.5-pro',
        messages: [],
        toolChoice: 'none',
      }).toolConfig,
    ).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });

  it('maps named toolChoice via allowedFunctionNames', () => {
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [],
      toolChoice: { name: 'grep' },
    });
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['grep'] },
    });
  });

  it('maps responseFormat json_object to application/json mime', () => {
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [],
      responseFormat: { type: 'json_object' },
    });
    expect(body.generationConfig?.responseMimeType).toBe('application/json');
    expect(body.generationConfig?.responseSchema).toBeUndefined();
  });

  it('maps responseFormat json_schema with schema', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } } as const;
    const body = buildChatRequestBody({
      model: 'gemini-2.5-pro',
      messages: [],
      responseFormat: { type: 'json_schema', schema },
    });
    expect(body.generationConfig?.responseMimeType).toBe('application/json');
    expect(body.generationConfig?.responseSchema).toEqual(schema);
  });
});
