import { describe, expect, it } from 'vitest';
import {
  computeRetryDelayMs,
  exponentialBackoffMs,
  fetchWithRetry,
  parseRetryAfter,
} from './retry';

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5_000);
  });

  it('clamps absurd values to 1 hour', () => {
    expect(parseRetryAfter('99999999')).toBe(3_600_000);
  });

  it('returns undefined for empty header', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
  });

  it('parses HTTP-date and computes delta', () => {
    const now = Date.parse('2025-01-01T00:00:00Z');
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:10 GMT', now)).toBe(10_000);
  });

  it('clamps past-date Retry-After to 0', () => {
    const now = Date.parse('2025-01-02T00:00:00Z');
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:00 GMT', now)).toBe(0);
  });
});

describe('exponentialBackoffMs', () => {
  it('respects baseMs and capMs', () => {
    const delay = exponentialBackoffMs({ attempt: 100, baseMs: 100, capMs: 1000, jitter: () => 1 });
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it('grows roughly exponentially before the cap', () => {
    const a = exponentialBackoffMs({ attempt: 0, baseMs: 100, capMs: 10_000, jitter: () => 1 });
    const b = exponentialBackoffMs({ attempt: 2, baseMs: 100, capMs: 10_000, jitter: () => 1 });
    expect(b).toBeGreaterThan(a);
  });
});

describe('computeRetryDelayMs', () => {
  it('prefers Retry-After header over backoff', () => {
    expect(computeRetryDelayMs({ attempt: 5, retryAfter: '3' })).toBe(3_000);
  });

  it('falls back to backoff when no header', () => {
    const delay = computeRetryDelayMs({
      attempt: 0,
      baseMs: 100,
      capMs: 500,
      jitter: () => 1,
    });
    expect(delay).toBeLessThanOrEqual(500);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});

describe('fetchWithRetry', () => {
  it('returns ok response immediately without retrying', async () => {
    let calls = 0;
    const res = await fetchWithRetry(async () => {
      calls += 1;
      return new Response('ok', { status: 200 });
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it('retries on 429 honoring Retry-After', async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls += 1;
        if (calls < 2) {
          return new Response('rate', {
            status: 429,
            headers: { 'retry-after': '0' },
          });
        }
        return new Response('ok', { status: 200 });
      },
      { maxAttempts: 3, sleep: async () => {} },
    );
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it('retries a 429 by default and returns the eventual success', async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          return new Response('rate', { status: 429, headers: { 'retry-after': '0' } });
        }
        return new Response('ok', { status: 200 });
      },
      { sleep: async () => {} },
    );
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it('honors an explicit maxAttempts=1 opt-out', async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls += 1;
        return new Response('rate', { status: 429 });
      },
      { maxAttempts: 1, sleep: async () => {} },
    );
    expect(calls).toBe(1);
    expect(res.status).toBe(429);
  });

  it('stops after maxAttempts and returns last response', async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls += 1;
        return new Response('boom', { status: 500 });
      },
      { maxAttempts: 2, sleep: async () => {} },
    );
    expect(calls).toBe(2);
    expect(res.status).toBe(500);
  });

  it('does not retry 4xx other than 408/425/429', async () => {
    let calls = 0;
    await fetchWithRetry(
      async () => {
        calls += 1;
        return new Response('bad', { status: 400 });
      },
      { maxAttempts: 3, sleep: async () => {} },
    );
    expect(calls).toBe(1);
  });
});
