import { describe, expect, it } from 'vitest';
import { buildChatRequestBody } from './translate-request';

describe('buildChatRequestBody', () => {
  it('maps toolChoice strings (required -> any)', () => {
    expect(
      buildChatRequestBody(
        { model: 'mistral-large-latest', messages: [], toolChoice: 'auto' },
        { stream: false },
      ).tool_choice,
    ).toBe('auto');
    expect(
      buildChatRequestBody(
        { model: 'mistral-large-latest', messages: [], toolChoice: 'required' },
        { stream: false },
      ).tool_choice,
    ).toBe('any');
    expect(
      buildChatRequestBody(
        { model: 'mistral-large-latest', messages: [], toolChoice: 'none' },
        { stream: false },
      ).tool_choice,
    ).toBe('none');
  });

  it('maps named toolChoice to function selector', () => {
    const body = buildChatRequestBody(
      { model: 'mistral-large-latest', messages: [], toolChoice: { name: 'grep' } },
      { stream: false },
    );
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'grep' } });
  });

  it('maps responseFormat json_object', () => {
    const body = buildChatRequestBody(
      {
        model: 'mistral-large-latest',
        messages: [],
        responseFormat: { type: 'json_object' },
      },
      { stream: false },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('flattens json_schema to json_object (Mistral has no native json_schema)', () => {
    const body = buildChatRequestBody(
      {
        model: 'mistral-large-latest',
        messages: [],
        responseFormat: { type: 'json_schema', schema: { type: 'object' } },
      },
      { stream: false },
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});
