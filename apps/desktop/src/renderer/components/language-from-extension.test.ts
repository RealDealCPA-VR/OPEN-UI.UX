import { describe, expect, it } from 'vitest';
import { languageFromPath } from './language-from-extension';

describe('languageFromPath', () => {
  it('returns plaintext for empty / no extension', () => {
    expect(languageFromPath('')).toBe('plaintext');
    expect(languageFromPath('LICENSE')).toBe('plaintext');
    expect(languageFromPath('foo.')).toBe('plaintext');
  });

  it('maps common code extensions', () => {
    expect(languageFromPath('src/foo.ts')).toBe('typescript');
    expect(languageFromPath('src/foo.tsx')).toBe('typescript');
    expect(languageFromPath('src/foo.js')).toBe('javascript');
    expect(languageFromPath('foo.py')).toBe('python');
    expect(languageFromPath('foo.go')).toBe('go');
    expect(languageFromPath('foo.rs')).toBe('rust');
    expect(languageFromPath('schema.sql')).toBe('sql');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageFromPath('foo.TS')).toBe('typescript');
    expect(languageFromPath('foo.JSON')).toBe('json');
  });

  it('handles windows-style paths', () => {
    expect(languageFromPath('C:\\users\\me\\foo.ts')).toBe('typescript');
  });

  it('recognises Dockerfile by basename', () => {
    expect(languageFromPath('build/Dockerfile')).toBe('dockerfile');
    expect(languageFromPath('Dockerfile')).toBe('dockerfile');
  });

  it('falls back to plaintext for unknown extensions', () => {
    expect(languageFromPath('foo.xyz123')).toBe('plaintext');
  });
});
