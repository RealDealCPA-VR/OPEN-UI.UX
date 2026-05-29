import { describe, expect, it } from 'vitest';
import { buildChatRequestBody } from './translate-request';

describe('buildChatRequestBody', () => {
  it("maps responseFormat json_object to format: 'json'", () => {
    const body = buildChatRequestBody(
      { model: 'llama3.1', messages: [], responseFormat: { type: 'json_object' } },
      { stream: false },
    );
    expect(body.format).toBe('json');
  });

  it('maps responseFormat json_schema to inline schema (Ollama supports schema object)', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } } as const;
    const body = buildChatRequestBody(
      { model: 'llama3.1', messages: [], responseFormat: { type: 'json_schema', schema } },
      { stream: false },
    );
    expect(body.format).toEqual(schema);
  });

  it('leaves format unset when no responseFormat provided', () => {
    const body = buildChatRequestBody({ model: 'llama3.1', messages: [] }, { stream: false });
    expect(body.format).toBeUndefined();
  });
});
