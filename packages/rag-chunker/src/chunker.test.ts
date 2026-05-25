import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  chunkBySize,
  chunkBySymbols,
  hasGrammar,
  registerGrammar,
} from './index';

describe('SUPPORTED_LANGUAGES', () => {
  it('covers ~15 top languages', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(15);
    expect(SUPPORTED_LANGUAGES).toContain('typescript');
    expect(SUPPORTED_LANGUAGES).toContain('python');
    expect(SUPPORTED_LANGUAGES).toContain('rust');
  });

  it('is a tuple of unique entries', () => {
    expect(new Set(SUPPORTED_LANGUAGES).size).toBe(SUPPORTED_LANGUAGES.length);
  });
});

describe('chunkBySize', () => {
  it('returns one chunk when the text fits in maxChars', () => {
    const text = 'line one\nline two\nline three';
    const chunks = chunkBySize(text, 1500, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(3);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkBySize('', 1500, 100)).toEqual([]);
  });

  it('splits a long text into multiple chunks', () => {
    const line = 'x'.repeat(80);
    const text = Array.from({ length: 60 }, () => line).join('\n');
    const chunks = chunkBySize(text, 500, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500);
  });

  it('produces overlapping chunks that cover the whole input', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    const chunks = chunkBySize(text, 60, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // Every line index 1..30 should appear in at least one chunk's [startLine, endLine].
    for (let line = 1; line <= 30; line++) {
      const covered = chunks.some((c) => c.startLine <= line && c.endLine >= line);
      expect(covered).toBe(true);
    }
  });

  it('keeps line numbers aligned with content', () => {
    const text = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj';
    const chunks = chunkBySize(text, 6, 2);
    for (const c of chunks) {
      const expected = text
        .split('\n')
        .slice(c.startLine - 1, c.endLine)
        .join('\n');
      expect(c.content).toBe(expected);
    }
  });

  it('rejects invalid options', () => {
    expect(() => chunkBySize('abc', 0, 0)).toThrow();
    expect(() => chunkBySize('abc', 100, -1)).toThrow();
    expect(() => chunkBySize('abc', 100, 100)).toThrow();
  });
});

describe('chunkBySymbols', () => {
  it('falls back to size chunking when language has no registered grammar', async () => {
    const text = 'def hi():\n    return 1\n\ndef bye():\n    return 2\n';
    const chunks = await chunkBySymbols(text, 'cobol', { maxChars: 1500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.symbolPath).toBeUndefined();
  });

  it('falls back to size chunking when grammar load fails', async () => {
    // Register a bogus grammar source — Language.load will reject; we should
    // gracefully degrade to chunkBySize without throwing to the caller.
    registerGrammar('fake-lang', new Uint8Array([0, 0, 0, 0]));
    expect(hasGrammar('fake-lang')).toBe(true);
    const text = 'whatever\nstill works\n';
    const chunks = await chunkBySymbols(text, 'fake-lang', { maxChars: 1500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
  });
});
