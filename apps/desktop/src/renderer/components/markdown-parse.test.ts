import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown-parse';

describe('parseMarkdown', () => {
  it('parses paragraphs separated by blank lines', () => {
    const blocks = parseMarkdown('hello world\n\nsecond paragraph');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'hello world' },
      { kind: 'paragraph', text: 'second paragraph' },
    ]);
  });

  it('parses fenced code blocks with language', () => {
    const md = ['```ts', 'const x = 1;', 'const y = 2;', '```'].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks).toEqual([{ kind: 'code', language: 'ts', body: 'const x = 1;\nconst y = 2;' }]);
  });

  it('parses fenced code blocks with no language', () => {
    const blocks = parseMarkdown('```\nfoo\n```');
    expect(blocks).toEqual([{ kind: 'code', language: null, body: 'foo' }]);
  });

  it('parses an unclosed code block to end of input', () => {
    const blocks = parseMarkdown('```python\nfoo\nbar');
    expect(blocks).toEqual([{ kind: 'code', language: 'python', body: 'foo\nbar' }]);
  });

  it('parses headings up to level 6', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('parses unordered lists', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');
    expect(blocks).toEqual([{ kind: 'list', items: ['one', 'two', 'three'] }]);
  });

  it('parses blockquotes that span multiple lines', () => {
    const blocks = parseMarkdown('> first\n> second');
    expect(blocks).toEqual([{ kind: 'blockquote', text: 'first second' }]);
  });

  it('parses horizontal rules', () => {
    const blocks = parseMarkdown('hello\n\n---\n\nworld');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'hello' },
      { kind: 'hr' },
      { kind: 'paragraph', text: 'world' },
    ]);
  });

  it('does not nest code-fence content as paragraphs', () => {
    const md = 'before\n\n```\nlet x = 1;\n```\n\nafter';
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
  });

  it('handles CRLF line endings', () => {
    const blocks = parseMarkdown('hello\r\n\r\nworld');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'hello' },
      { kind: 'paragraph', text: 'world' },
    ]);
  });
});
