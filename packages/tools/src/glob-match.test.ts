import { describe, it, expect } from 'vitest';
import { globToRegExp } from './glob-match';

describe('globToRegExp', () => {
  it('matches a literal filename', () => {
    const re = globToRegExp('package.json');
    expect(re.test('package.json')).toBe(true);
    expect(re.test('foo/package.json')).toBe(false);
  });

  it('* matches within a path segment but not across separators', () => {
    const re = globToRegExp('*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('a.b.ts')).toBe(true);
    expect(re.test('src/a.ts')).toBe(false);
  });

  it('**/ matches zero or more directories', () => {
    const re = globToRegExp('**/*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/nested/deep/a.ts')).toBe(true);
    expect(re.test('a.tsx')).toBe(false);
  });

  it('? matches a single non-separator character', () => {
    const re = globToRegExp('a?.txt');
    expect(re.test('ab.txt')).toBe(true);
    expect(re.test('abc.txt')).toBe(false);
    expect(re.test('a.txt')).toBe(false);
  });

  it('escapes regex meta characters', () => {
    const re = globToRegExp('a.b+c$.txt');
    expect(re.test('a.b+c$.txt')).toBe(true);
    expect(re.test('axb+c$.txt')).toBe(false);
  });

  it('expands brace alternatives', () => {
    const re = globToRegExp('**/*.{ts,tsx}');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('a.tsx')).toBe(true);
    expect(re.test('a.js')).toBe(false);
  });

  it('handles a complex path glob', () => {
    const re = globToRegExp('src/**/*.test.ts');
    expect(re.test('src/foo.test.ts')).toBe(true);
    expect(re.test('src/sub/foo.test.ts')).toBe(true);
    expect(re.test('lib/foo.test.ts')).toBe(false);
    expect(re.test('src/foo.ts')).toBe(false);
  });
});
