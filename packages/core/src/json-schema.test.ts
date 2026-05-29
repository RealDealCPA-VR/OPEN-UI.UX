import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJSONSchema, UnsupportedZodTypeError } from './json-schema';

describe('zodToJSONSchema', () => {
  it('converts a flat object with required primitives', () => {
    const schema = z.object({ path: z.string(), count: z.number(), flag: z.boolean() });
    const result = zodToJSONSchema(schema);
    expect(result.type).toBe('object');
    expect(result.properties).toMatchObject({
      path: { type: 'string' },
      count: { type: 'number' },
      flag: { type: 'boolean' },
    });
    expect(result.required).toEqual(['path', 'count', 'flag']);
    expect(result.additionalProperties).toBe(false);
  });

  it('omits required entry for optional fields and preserves declaration order', () => {
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
    expect(result.properties?.caseInsensitive).toMatchObject({ type: 'boolean' });
  });

  it('encodes z.string().url() as format: uri', () => {
    const result = zodToJSONSchema(z.object({ url: z.string().url() }));
    expect(result.properties?.url).toMatchObject({ type: 'string', format: 'uri' });
  });

  it('encodes z.enum() as string + enum', () => {
    const result = zodToJSONSchema(z.object({ method: z.enum(['GET', 'POST']) }));
    expect(result.properties?.method).toMatchObject({ type: 'string', enum: ['GET', 'POST'] });
  });

  it('encodes z.array() with items', () => {
    const result = zodToJSONSchema(z.object({ tags: z.array(z.string()) }));
    expect(result.properties?.tags).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('preserves .describe() text', () => {
    const schema = z.object({
      path: z.string().describe('Absolute path relative to workspace root'),
    });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.path).toMatchObject({
      type: 'string',
      description: 'Absolute path relative to workspace root',
    });
  });

  it('unwraps ZodDefault to its inner type', () => {
    const schema = z.object({ limit: z.number().default(100) });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.limit).toMatchObject({ type: 'number' });
  });

  it('encodes z.record(z.string()) as object with string additionalProperties', () => {
    const result = zodToJSONSchema(z.object({ headers: z.record(z.string()) }));
    expect(result.properties?.headers).toMatchObject({
      type: 'object',
      additionalProperties: { type: 'string' },
    });
  });

  it('encodes z.literal()', () => {
    const result = zodToJSONSchema(z.object({ kind: z.literal('hello') }));
    const kind = result.properties?.kind as Record<string, unknown> | undefined;
    expect(kind).toBeDefined();
    expect(kind?.const ?? (kind?.enum as unknown[] | undefined)?.[0]).toBe('hello');
  });

  it('encodes z.union() of strings', () => {
    const result = zodToJSONSchema(z.object({ choice: z.union([z.string(), z.number()]) }));
    expect(result.properties?.choice).toBeDefined();
  });

  it('encodes z.discriminatedUnion()', () => {
    const schema = z.object({
      event: z.discriminatedUnion('type', [
        z.object({ type: z.literal('a'), value: z.string() }),
        z.object({ type: z.literal('b'), count: z.number() }),
      ]),
    });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.event).toBeDefined();
  });

  it('encodes z.effects() (.refine())', () => {
    const schema = z.object({
      n: z.number().refine((v) => v > 0, 'must be positive'),
    });
    const result = zodToJSONSchema(schema);
    expect(result.properties?.n).toMatchObject({ type: 'number' });
  });

  it('encodes z.any() and z.unknown()', () => {
    const result = zodToJSONSchema(z.object({ a: z.any(), b: z.unknown() }));
    expect(result.properties?.a).toBeDefined();
    expect(result.properties?.b).toBeDefined();
  });

  it('encodes z.tuple()', () => {
    const result = zodToJSONSchema(z.object({ coords: z.tuple([z.number(), z.number()]) }));
    expect(result.properties?.coords).toMatchObject({ type: 'array' });
  });

  it('handles z.lazy() recursive definitions without throwing', () => {
    type Tree = { v: string; children?: Tree[] };
    const tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({ v: z.string(), children: z.array(tree).optional() }),
    );
    expect(() => zodToJSONSchema(z.object({ root: tree }))).not.toThrow();
  });

  it('does not throw UnsupportedZodTypeError for previously unsupported types', () => {
    expect(() => zodToJSONSchema(z.object({ d: z.date() }))).not.toThrow();
  });

  it('exports UnsupportedZodTypeError for backward compatibility', () => {
    const err = new UnsupportedZodTypeError('SomeType');
    expect(err.name).toBe('UnsupportedZodTypeError');
    expect(err.message).toContain('SomeType');
  });
});
