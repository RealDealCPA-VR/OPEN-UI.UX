import { describe, expect, it } from 'vitest';
import { __testOnly } from './extract-tarball';

const { assertSafePath, stripFirstSegment, joinTarPath } = __testOnly;

describe('extract-tarball path safety', () => {
  it('rejects absolute paths', () => {
    expect(() => assertSafePath('/tmp/dest', '/etc/passwd')).toThrow(/absolute/);
  });

  it('rejects ../ traversal', () => {
    expect(() => assertSafePath('/tmp/dest', '../escape.txt')).toThrow(/escapes destination/);
  });

  it('rejects NUL bytes', () => {
    expect(() => assertSafePath('/tmp/dest', 'ok\0bad')).toThrow(/NUL byte/);
  });

  it('accepts a legal relative path', () => {
    const r = assertSafePath('/tmp/dest', 'pkg/lib/index.js');
    expect(r.endsWith('index.js')).toBe(true);
  });

  it('joins tar prefix and name', () => {
    expect(joinTarPath('foo', 'bar')).toBe('foo/bar');
    expect(joinTarPath('foo/', 'bar')).toBe('foo/bar');
    expect(joinTarPath('', 'bar')).toBe('bar');
  });

  it('strips first segment of a tar path', () => {
    expect(stripFirstSegment('package/lib/index.js')).toBe('lib/index.js');
    expect(stripFirstSegment('top')).toBe('');
    expect(stripFirstSegment('a/b/c')).toBe('b/c');
  });
});
