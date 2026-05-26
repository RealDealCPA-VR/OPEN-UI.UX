import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from './glob-match';

describe('globToRegExp', () => {
  it('matches a literal filename', () => {
    expect(globToRegExp('README.md').test('README.md')).toBe(true);
    expect(globToRegExp('README.md').test('readme.md')).toBe(false);
  });

  it('matches *.ts at the root', () => {
    const re = globToRegExp('*.ts');
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('foo.js')).toBe(false);
    expect(re.test('src/foo.ts')).toBe(false);
  });

  it('matches **/*.ts across directories', () => {
    const re = globToRegExp('**/*.ts');
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('a/b/c/foo.ts')).toBe(true);
    expect(re.test('foo.js')).toBe(false);
  });

  it('handles brace expansion', () => {
    const re = globToRegExp('**/*.{ts,tsx}');
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('foo.tsx')).toBe(true);
    expect(re.test('foo.js')).toBe(false);
    expect(re.test('src/components/X.tsx')).toBe(true);
  });

  it('handles ? wildcard', () => {
    const re = globToRegExp('a?c.txt');
    expect(re.test('abc.txt')).toBe(true);
    expect(re.test('axc.txt')).toBe(true);
    expect(re.test('ac.txt')).toBe(false);
    expect(re.test('a/c.txt')).toBe(false);
  });

  it('matchesGlob convenience returns false on invalid pattern silently', () => {
    expect(matchesGlob('**/*.ts', 'a/b.ts')).toBe(true);
    expect(matchesGlob('**/*.ts', 'a/b.js')).toBe(false);
  });
});
