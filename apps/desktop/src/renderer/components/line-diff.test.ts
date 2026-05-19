import { describe, expect, it } from 'vitest';
import { diffLines } from './line-diff';

describe('diffLines', () => {
  it('returns no diff for identical inputs', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.lines.every((l) => l.kind === 'context')).toBe(true);
  });

  it('treats empty before as all additions', () => {
    const result = diffLines('', 'a\nb');
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.lines.map((l) => l.kind)).toEqual(['add', 'add']);
  });

  it('treats empty after as all removals', () => {
    const result = diffLines('a\nb', '');
    expect(result.added).toBe(0);
    expect(result.removed).toBe(2);
    expect(result.lines.map((l) => l.kind)).toEqual(['remove', 'remove']);
  });

  it('detects a single-line change as remove + add', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc');
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    const kinds = result.lines.map((l) => l.kind);
    expect(kinds).toContain('remove');
    expect(kinds).toContain('add');
    expect(kinds.filter((k) => k === 'context').length).toBe(2);
  });

  it('tracks old/new line numbers correctly', () => {
    const result = diffLines('a\nb\nc', 'a\nX\nb\nc');
    const add = result.lines.find((l) => l.kind === 'add');
    expect(add?.newLine).toBe(2);
    expect(add?.oldLine).toBeNull();
    const lastContext = result.lines[result.lines.length - 1];
    expect(lastContext?.kind).toBe('context');
    expect(lastContext?.oldLine).toBe(3);
    expect(lastContext?.newLine).toBe(4);
  });

  it('truncates to maxLines but keeps full added/removed totals', () => {
    const before = Array.from({ length: 100 }, (_, i) => `old-${i}`).join('\n');
    const after = Array.from({ length: 100 }, (_, i) => `new-${i}`).join('\n');
    const result = diffLines(before, after, { maxLines: 10 });
    expect(result.lines.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.added).toBe(100);
    expect(result.removed).toBe(100);
  });

  it('handles CRLF and LF inputs consistently', () => {
    const result = diffLines('a\r\nb\r\nc', 'a\nb\nc');
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });
});
