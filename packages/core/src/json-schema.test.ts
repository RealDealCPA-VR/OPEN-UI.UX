import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJSONSchema, UnsupportedZodTypeError } from './json-schema';

describe('zodToJSONSchema', () => {
  it('converts a flat object with required primitives', () => {
    const schema = z.object({ path: z.string(), count: z.number(), flag: z.boolean() });
    expect(zodToJSONSchema(schema)).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string' },
        count: { type: 'number' },
        flag: { type: 'boolean' },
      },
      required: ['path', 'count', 'flag'],
      additionalProperties: false,
    });
  });

  it('omits required for optional fields and preserves declaration order', () => {
    const schema = z.object({
      pattern: z.string(),
      caseInsensitive: z.boolean().optional(),
      maxResults: z.number().optional(),
    });
    const result = zodToJSONSchema(schema);
    expect(result.required).toEqual(['pattern']);
    expect(Object.keys(result.properties ?? {})).toEqual([
      'pattern',
      'caseInsensitive',
      'maxResults',
    ]);
    expect(result.properties?.caseInsensitive).toEqual({ type: 'boolean' });
  });

  it('emits no required key when every field is optional', () => {
    const schema = z.object({ a: z.string().optional(), b: z.number().optional() });
    const result = zodToJSONSchema(schema);
    expect(result.required).toBeUndefined();
  });

  it('encodes z.string().url() as format: uri', () => {
    const result = zodToJSONSchema(z.object({ url: z.string().url() }));
    expect(result.properties?.url).toEqual({ type: 'string', format: 'uri' });
  });

  it('encodes z.enum() as string + enum', () => {
    const result = zodToJSONSchema(z.object({ method: z.enum(['GET', 'POST']) }));
    expect(result.properties?.method).toEqual({ type: 'string', enum: ['GET', 'POST'] });
  });

  it('encodes z.array() with items', () => {
    const result = zodToJSONSchema(z.object({ tags: z.array(z.string()) }));
    expect(result.properties?.tags).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('preserves .describe() text', () => {
    const schema = z.object({
      path: z.string().describe('Absolute path relative to workspace root'),
    });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.path).toEqual({
      type: 'string',
      description: 'Absolute path relative to workspace root',
    });
  });

  it('unwraps ZodDefault to its inner type and treats it as optional', () => {
    const schema = z.object({ limit: z.number().default(100) });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.limit).toEqual({ type: 'number' });
    expect(result.required).toBeUndefined();
  });

  it('encodes z.record(z.string()) as object with string additionalProperties', () => {
    const result = zodToJSONSchema(z.object({ headers: z.record(z.string()) }));
    expect(result.properties?.headers).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' },
    });
  });

  it('throws UnsupportedZodTypeError for unhandled types', () => {
    expect(() => zodToJSONSchema(z.object({ d: z.date() }))).toThrow(UnsupportedZodTypeError);
  });
});
