import { describe, expect, it } from 'vitest';
import { makeNodeId, normalizeLabel } from './ids';

describe('normalizeLabel', () => {
  it('casefolds', () => {
    expect(normalizeLabel('FooBar')).toBe('foobar');
    expect(normalizeLabel('HTTPServer')).toBe('httpserver');
  });

  it('replaces runs of punctuation/whitespace with a single underscore', () => {
    expect(normalizeLabel('foo  bar')).toBe('foo_bar');
    expect(normalizeLabel('foo...bar')).toBe('foo_bar');
    expect(normalizeLabel('foo - bar')).toBe('foo_bar');
    expect(normalizeLabel('a/b\\c')).toBe('a_b_c');
  });

  it('collapses multiple underscores', () => {
    expect(normalizeLabel('foo___bar')).toBe('foo_bar');
    expect(normalizeLabel('a__b__c')).toBe('a_b_c');
  });

  it('trims leading and trailing underscores', () => {
    expect(normalizeLabel('__foo__')).toBe('foo');
    expect(normalizeLabel('...foo...')).toBe('foo');
    expect(normalizeLabel('  foo  ')).toBe('foo');
  });

  it('preserves internal single underscores', () => {
    expect(normalizeLabel('foo_bar')).toBe('foo_bar');
    expect(normalizeLabel('_private')).toBe('private');
  });

  it('is unicode-aware (NFKC + letter/number classes)', () => {
    // Fullwidth ABC normalizes to ASCII under NFKC, then casefolds.
    expect(normalizeLabel('ＡＢＣ')).toBe('abc');
    // Accented letters are word chars and are preserved (lowercased).
    expect(normalizeLabel('Café')).toBe('café');
    // Digits are kept.
    expect(normalizeLabel('Foo2Bar')).toBe('foo2bar');
  });

  it('handles non-latin scripts as word characters', () => {
    expect(normalizeLabel('変数名')).toBe('変数名');
    expect(normalizeLabel('переменная')).toBe('переменная');
  });

  it('is deterministic and idempotent', () => {
    const once = normalizeLabel('Foo..Bar  Baz');
    expect(normalizeLabel(once)).toBe(once);
  });

  it('reduces a pure-punctuation label to empty string', () => {
    expect(normalizeLabel('...')).toBe('');
    expect(normalizeLabel('   ')).toBe('');
  });
});

describe('makeNodeId', () => {
  it('joins parts with ::', () => {
    expect(makeNodeId(['src/a.ts', 'Foo', 'bar'])).toBe('src/a.ts::Foo::bar');
  });

  it('drops empty and whitespace-only parts', () => {
    expect(makeNodeId(['a', '', '  ', 'b'])).toBe('a::b');
  });
});
