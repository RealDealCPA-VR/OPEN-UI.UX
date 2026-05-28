import { describe, expect, it, vi } from 'vitest';
import { withSqliteBusyRetry } from './sqlite-retry';

// NOTE: sqlite-retry.ts calls Atomics.wait directly (no DI seam for the sleep
// helper), so these tests do not assert on timing precision. They only assert
// on call counts, propagation, and retry-budget behavior. Real-time delays
// happen between attempts (50ms then 250ms) but tests run them through.

describe('withSqliteBusyRetry', () => {
  it('returns the value on first attempt and calls fn exactly once', () => {
    const fn = vi.fn(() => 'ok');
    expect(withSqliteBusyRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on SQLITE_BUSY and returns the eventual value', () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      if (calls === 1) {
        throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
      }
      return 'done';
    });
    expect(withSqliteBusyRetry(fn)).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on SQLITE_LOCKED as well as SQLITE_BUSY', () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      if (calls === 1) {
        throw Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' });
      }
      return 'done';
    });
    expect(withSqliteBusyRetry(fn)).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-busy errors immediately without retry', () => {
    const err = Object.assign(new Error('boom'), { code: 'SQLITE_CORRUPT' });
    const fn = vi.fn(() => {
      throw err;
    });
    expect(() => withSqliteBusyRetry(fn)).toThrowError(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows generic errors with no code immediately', () => {
    const err = new Error('nope');
    const fn = vi.fn(() => {
      throw err;
    });
    expect(() => withSqliteBusyRetry(fn)).toThrowError(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget is exhausted (3 total attempts)', () => {
    const err = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
    const fn = vi.fn(() => {
      throw err;
    });
    expect(() => withSqliteBusyRetry(fn)).toThrowError(err);
    // initial + 2 retries (delays array length is 2) = 3 total invocations
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
