import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '@opencodex/core';
import {
  buildChatRequestBody,
  extractSystem,
  translateMessages,
  translateTools,
} from './translate-request';

const baseThinkReq: ChatRequest = {
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 1000,
  temperature: 0.5,
};

describe('buildChatRequestBody thinking (pre-4.6 extended thinking)', () => {
  it('omits thinking when reasoning is unset', () => {
    expect(buildChatRequestBody(baseThinkReq, { stream: false }).thinking).toBeUndefined();
  });
  it('enables thinking with the default budget for reasoning:true', () => {
    expect(
      buildChatRequestBody({ ...baseThinkReq, reasoning: true }, { stream: false }).thinking,
    ).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });
  it('bumps max_tokens above the thinking budget when too small', () => {
    expect(
      buildChatRequestBody({ ...baseThinkReq, reasoning: true }, { stream: false }).max_tokens,
    ).toBe(4096 + 1024);
  });
  it('strips temperature and top_p when thinking is enabled', () => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, topP: 0.9, reasoning: { effort: 'high' } },
      { stream: false },
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(body.output_config).toBeUndefined();
  });
  it('uses an explicit maxTokens budget, floored to 1024', () => {
    expect(
      buildChatRequestBody({ ...baseThinkReq, reasoning: { maxTokens: 500 } }, { stream: false })
        .thinking,
    ).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });
});

describe('buildChatRequestBody thinking (adaptive models)', () => {
  const models = ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'];
  it.each(models)('emits adaptive thinking with no budget on %s', (model) => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, model, reasoning: true },
      { stream: false },
    );
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(1000);
  });
  it('emits adaptive thinking on haiku 4.5, including dated IDs', () => {
    for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
      expect(
        buildChatRequestBody({ ...baseThinkReq, model, reasoning: true }, { stream: false })
          .thinking,
      ).toEqual({ type: 'adaptive' });
    }
  });
  it('maps reasoning effort to output_config.effort on effort-capable models', () => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, model: 'claude-opus-4-7', reasoning: { effort: 'high' } },
      { stream: false },
    );
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });
  it('does not send output_config.effort to haiku 4.5', () => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, model: 'claude-haiku-4-5', reasoning: { effort: 'low' } },
      { stream: false },
    );
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toBeUndefined();
  });
  it('ignores reasoning.maxTokens on adaptive models (no budget_tokens)', () => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, model: 'claude-opus-4-8', reasoning: { maxTokens: 50_000 } },
      { stream: false },
    );
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.max_tokens).toBe(1000);
  });
  it('strips temperature and top_p when adaptive thinking is on', () => {
    const body = buildChatRequestBody(
      { ...baseThinkReq, model: 'claude-sonnet-4-6', topP: 0.9, reasoning: true },
      { stream: false },
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });
});

describe('buildChatRequestBody sampling params on Opus 4.7/4.8', () => {
  it.each(['claude-opus-4-7', 'claude-opus-4-8'])(
    'never sends temperature/top_p to %s even without reasoning',
    (model) => {
      const body = buildChatRequestBody(
        { model, messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, topP: 0.9 },
        { stream: false },
      );
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
    },
  );
  it('still forwards temperature/top_p to 4.6-family models without reasoning', () => {
    const body = buildChatRequestBody(
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        topP: 0.9,
      },
      { stream: false },
    );
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
  });
});

describe('extractSystem', () => {
  it('pulls a single string system message out and joins with body text', () => {
    const { system, rest } = extractSystem([
      { role: 'system', content: 'you are concise' },
      { role: 'user', content: 'hi' },
    ]);
    expect(system).toBe('you are concise');
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
  it('wraps string content into a single text block', () => {
    expect(translateMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('translates image blocks to base64 source objects', () => {
    expect(
      translateMessages([
        { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }] },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        ],
      },
    ]);
  });

  it('translates assistant tool_use into a tool_use block with parsed input', () => {
    expect(
      translateMessages([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'toolu_1', name: 'grep', arguments: { q: 'x' } },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool_use', id: 'toolu_1', name: 'grep', input: { q: 'x' } },
        ],
      },
    ]);
  });

  it('parses stringified tool_use arguments back to JSON', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'f', arguments: '{"a":1}' }],
      },
    ]);
    expect(out[0]?.content[0]).toEqual({ type: 'tool_use', id: 't', name: 'f', input: { a: 1 } });
  });

  it('keeps raw string when tool_use arguments fail to parse', () => {
    const out = translateMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'f', arguments: 'not-json' }],
      },
    ]);
    expect(out[0]?.content[0]).toMatchObject({ type: 'tool_use', input: 'not-json' });
  });

  it('emits tool role messages as user tool_result blocks', () => {
    expect(
      translateMessages([
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolUseId: 'toolu_1', output: 'found 3 hits' }],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'found 3 hits' }],
      },
    ]);
  });

  it('serializes non-string tool_result output as JSON', () => {
    const out = translateMessages([
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 't', output: { matches: 3 } }],
      },
    ]);
    expect(out[0]?.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 't',
      content: '{"matches":3}',
    });
  });

  it('marks is_error when tool_result has isError', () => {
    const out = translateMessages([
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 't', output: 'boom', isError: true }],
      },
    ]);
    expect(out[0]?.content[0]).toMatchObject({ is_error: true });
  });

  it('drops empty-string user messages instead of emitting empty content', () => {
    expect(translateMessages([{ role: 'user', content: '' }])).toEqual([]);
  });
});

describe('translateTools', () => {
  it('returns undefined when empty', () => {
    expect(translateTools(undefined)).toBeUndefined();
    expect(translateTools([])).toBeUndefined();
  });

  it('renames inputSchema to input_schema', () => {
    expect(
      translateTools([
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          permissionTier: 'read',
        },
      ]),
    ).toEqual([{ name: 'read', description: 'Read a file', input_schema: { type: 'object' } }]);
  });
});

describe('buildChatRequestBody', () => {
  it('sets stream when streaming', () => {
    const body = buildChatRequestBody(
      { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] },
      { stream: true },
    );
    expect(body.stream).toBe(true);
  });

  it('extracts system out of the messages list', () => {
    const body = buildChatRequestBody(
      {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
      },
      { stream: false },
    );
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('uses model-specific max_tokens by default and respects override', () => {
    const dflt = buildChatRequestBody(
      { model: 'claude-sonnet-4-6', messages: [] },
      { stream: false },
    );
    expect(dflt.max_tokens).toBe(64_000);

    const override = buildChatRequestBody(
      { model: 'claude-sonnet-4-6', messages: [], maxTokens: 512 },
      { stream: false },
    );
    expect(override.max_tokens).toBe(512);
  });

  it('falls back to 4096 max_tokens for unknown models', () => {
    const body = buildChatRequestBody({ model: 'mystery-model', messages: [] }, { stream: false });
    expect(body.max_tokens).toBe(4_096);
  });

  it('forwards optional params only when set', () => {
    const body = buildChatRequestBody(
      {
        model: 'claude-sonnet-4-6',
        messages: [],
        temperature: 0.7,
        topP: 0.9,
        stop: ['END'],
      },
      { stream: false },
    );
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.stop_sequences).toEqual(['END']);
  });

  it('omits tools when none provided or empty', () => {
    const body = buildChatRequestBody(
      { model: 'claude-sonnet-4-6', messages: [], tools: [] },
      { stream: false },
    );
    expect(body.tools).toBeUndefined();
  });

  it('maps toolChoice strings to Anthropic shape', () => {
    expect(
      buildChatRequestBody(
        { model: 'claude-sonnet-4-6', messages: [], toolChoice: 'auto' },
        { stream: false },
      ).tool_choice,
    ).toEqual({ type: 'auto' });
    expect(
      buildChatRequestBody(
        { model: 'claude-sonnet-4-6', messages: [], toolChoice: 'required' },
        { stream: false },
      ).tool_choice,
    ).toEqual({ type: 'any' });
    expect(
      buildChatRequestBody(
        { model: 'claude-sonnet-4-6', messages: [], toolChoice: 'none' },
        { stream: false },
      ).tool_choice,
    ).toEqual({ type: 'none' });
  });

  it('maps named toolChoice to tool-type selector', () => {
    const body = buildChatRequestBody(
      { model: 'claude-sonnet-4-6', messages: [], toolChoice: { name: 'read_file' } },
      { stream: false },
    );
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'read_file' });
  });
});
