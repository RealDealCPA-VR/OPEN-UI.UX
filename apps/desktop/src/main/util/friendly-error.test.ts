import { describe, expect, it } from 'vitest';
import { friendlyErrorMessage, toFriendlyError } from './friendly-error';

describe('friendlyErrorMessage — errno codes', () => {
  it.each([
    ['ENOENT', 'File not found'],
    ['EACCES', 'Permission denied'],
    ['EPERM', 'Operation not permitted'],
    ['EBUSY', 'busy'],
    ['EEXIST', 'Already exists'],
    ['EISDIR', 'directory'],
    ['ENOTDIR', 'file'],
    ['ENOSPC', 'Disk is full'],
    ['EMFILE', 'Too many open files'],
    ['ENFILE', 'Too many open files'],
    ['ETIMEDOUT', 'timed out'],
    ['ECONNREFUSED', 'refused'],
    ['ECONNRESET', 'reset'],
    ['ENETUNREACH', 'Network is unreachable'],
    ['EHOSTUNREACH', 'Host is unreachable'],
    ['EAI_AGAIN', 'resolve host'],
    ['ENOTFOUND', 'resolve host'],
  ])('maps %s to a friendly message containing %s', (code, expectedSubstring) => {
    const result = friendlyErrorMessage({ code });
    expect(result.toLowerCase()).toContain(expectedSubstring.toLowerCase());
  });
});

describe('friendlyErrorMessage — SQLite codes', () => {
  it.each([
    ['SQLITE_BUSY', 'busy'],
    ['SQLITE_LOCKED', 'locked'],
    ['SQLITE_CORRUPT', 'corrupt'],
    ['SQLITE_READONLY', 'read-only'],
  ])('maps %s to a friendly message containing %s', (code, expectedSubstring) => {
    const result = friendlyErrorMessage({ code });
    expect(result.toLowerCase()).toContain(expectedSubstring.toLowerCase());
  });
});

describe('friendlyErrorMessage — fallback', () => {
  it('falls back to original message on unknown code', () => {
    expect(friendlyErrorMessage({ code: 'EWHATEVER', message: 'raw thing went wrong' })).toBe(
      'raw thing went wrong',
    );
  });

  it('returns Unknown error for null', () => {
    expect(friendlyErrorMessage(null)).toBe('Unknown error');
  });

  it('returns Unknown error for undefined', () => {
    expect(friendlyErrorMessage(undefined)).toBe('Unknown error');
  });

  it('returns the string when passed a bare string', () => {
    expect(friendlyErrorMessage('boom')).toBe('boom');
  });

  it('shortens long paths into the message', () => {
    const long = '/a/b/c/d/e/foo.txt';
    const out = friendlyErrorMessage({ code: 'ENOENT', path: long });
    expect(out).toContain('e/foo.txt');
    expect(out).not.toContain('/a/b/c/');
  });

  it('returns Unknown error for an empty-ish object', () => {
    expect(friendlyErrorMessage({})).toBe('Unknown error');
  });
});

describe('toFriendlyError', () => {
  it('wraps with friendly message and preserves the cause', () => {
    const original = Object.assign(new Error('raw'), { code: 'ENOENT', path: '/p/q' });
    const wrapped = toFriendlyError(original);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message.toLowerCase()).toContain('not found');
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(original);
  });
});
