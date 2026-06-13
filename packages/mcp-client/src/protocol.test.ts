import { describe, expect, it } from 'vitest';
import { mcpCallToolResultSchema, mcpContentBlockSchema } from './protocol';

describe('mcpContentBlockSchema', () => {
  it('accepts text, image, and embedded resource blocks', () => {
    expect(mcpContentBlockSchema.parse({ type: 'text', text: 'hi' })).toMatchObject({
      type: 'text',
    });
    expect(
      mcpContentBlockSchema.parse({ type: 'image', data: 'aGk=', mimeType: 'image/png' }),
    ).toMatchObject({ type: 'image' });
    expect(
      mcpContentBlockSchema.parse({
        type: 'resource',
        resource: { uri: 'file:///a.txt', text: 'hi' },
      }),
    ).toMatchObject({ type: 'resource' });
  });

  it('accepts spec 2025-03-26 audio blocks', () => {
    const parsed = mcpContentBlockSchema.parse({
      type: 'audio',
      data: 'aGk=',
      mimeType: 'audio/wav',
    });
    expect(parsed).toEqual({ type: 'audio', data: 'aGk=', mimeType: 'audio/wav' });
  });

  it('accepts spec 2025-06-18 resource_link blocks', () => {
    const parsed = mcpContentBlockSchema.parse({
      type: 'resource_link',
      uri: 'file:///project/readme.md',
      name: 'readme.md',
      description: 'Project readme',
      mimeType: 'text/markdown',
    });
    expect(parsed).toMatchObject({ type: 'resource_link', uri: 'file:///project/readme.md' });
  });

  it('still rejects unknown block types', () => {
    expect(() => mcpContentBlockSchema.parse({ type: 'video', data: 'x' })).toThrow();
  });
});

describe('mcpCallToolResultSchema', () => {
  it('preserves structuredContent when present', () => {
    const parsed = mcpCallToolResultSchema.parse({
      content: [{ type: 'text', text: '{"ok":true}' }],
      structuredContent: { ok: true },
    });
    expect(parsed.structuredContent).toEqual({ ok: true });
  });

  it('keeps the legacy result shape valid (no structuredContent)', () => {
    const parsed = mcpCallToolResultSchema.parse({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
    expect(parsed.structuredContent).toBeUndefined();
    expect(parsed.isError).toBe(false);
  });
});
