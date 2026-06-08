import { describe, expect, it } from 'vitest';
import {
  artifactExtension,
  extractArtifactsFromText,
  pickLatestArtifact,
} from './extract-artifacts';

describe('extractArtifactsFromText', () => {
  it('extracts an html block', () => {
    const text = 'here:\n```html\n<h1>hi</h1>\n```\ndone';
    expect(extractArtifactsFromText(text, 'm1')).toEqual([
      { kind: 'html', code: '<h1>hi</h1>', messageId: 'm1', blockIndex: 0 },
    ]);
  });

  it('maps md and markdown to markdown, svg to svg', () => {
    const text = '```svg\n<svg/>\n```\n```md\n# Title\n```';
    const arts = extractArtifactsFromText(text, 'm');
    expect(arts.map((a) => a.kind)).toEqual(['svg', 'markdown']);
  });

  it('ignores non-previewable languages', () => {
    const text = '```ts\nconst x = 1;\n```\n```python\nprint(1)\n```';
    expect(extractArtifactsFromText(text, 'm')).toEqual([]);
  });

  it('skips empty blocks and tracks block index across all fences', () => {
    const text = '```ts\nx\n```\n```html\n<b>y</b>\n```';
    const arts = extractArtifactsFromText(text, 'm');
    expect(arts).toHaveLength(1);
    expect(arts[0]?.blockIndex).toBe(1);
  });
});

describe('pickLatestArtifact', () => {
  it('returns null when nothing previewable', () => {
    expect(pickLatestArtifact([{ id: 'a', role: 'assistant', content: 'plain text' }])).toBeNull();
  });

  it('ignores user messages', () => {
    expect(
      pickLatestArtifact([{ id: 'u', role: 'user', content: '```html\n<b>x</b>\n```' }]),
    ).toBeNull();
  });

  it('prefers the most recent assistant message with an artifact', () => {
    const art = pickLatestArtifact([
      { id: 'a1', role: 'assistant', content: '```svg\n<svg/>\n```' },
      { id: 'a2', role: 'assistant', content: '```html\n<b>new</b>\n```' },
    ]);
    expect(art?.messageId).toBe('a2');
    expect(art?.kind).toBe('html');
  });

  it('within a message, html beats svg beats markdown', () => {
    const art = pickLatestArtifact([
      {
        id: 'a',
        role: 'assistant',
        content: '```md\n# t\n```\n```svg\n<svg/>\n```\n```html\n<b>x</b>\n```',
      },
    ]);
    expect(art?.kind).toBe('html');
  });
});

describe('artifactExtension', () => {
  it('maps kinds to file extensions', () => {
    expect(artifactExtension('html')).toBe('html');
    expect(artifactExtension('svg')).toBe('svg');
    expect(artifactExtension('markdown')).toBe('md');
  });
});
