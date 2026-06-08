import { describe, expect, it } from 'vitest';
import { recencyOf, relativeTime } from './relative-time';

// Build all fixtures from LOCAL date components so the suite is timezone-
// independent (the formatter buckets by local calendar day).
const now = new Date(2026, 5, 7, 12, 0, 0); // 2026-06-07 12:00 local
const at = (y: number, mo: number, d: number, h = 8): string =>
  new Date(y, mo, d, h, 0, 0).toISOString();
const offsetMs = (ms: number): string => new Date(now.getTime() + ms).toISOString();

describe('relativeTime', () => {
  it('shows "Just now" for sub-minute and future times', () => {
    expect(relativeTime(offsetMs(-20_000), now)).toBe('Just now');
    expect(relativeTime(offsetMs(5 * 60_000), now)).toBe('Just now');
  });

  it('shows minutes and hours within the same day', () => {
    expect(relativeTime(offsetMs(-30 * 60_000), now)).toBe('30m ago');
    expect(relativeTime(at(2026, 5, 7, 9), now)).toBe('3h ago');
  });

  it('shows Yesterday and day counts', () => {
    expect(relativeTime(at(2026, 5, 6), now)).toBe('Yesterday');
    expect(relativeTime(at(2026, 5, 4), now)).toBe('3d ago');
  });

  it('shows weeks then falls back to a date', () => {
    expect(relativeTime(at(2026, 4, 24), now)).toBe('2w ago');
    const old = at(2026, 0, 1);
    expect(relativeTime(old, now)).toBe(new Date(old).toLocaleDateString());
  });

  it('returns empty string on invalid input', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});

describe('recencyOf', () => {
  it('buckets by age', () => {
    expect(recencyOf(at(2026, 5, 7, 1), now)).toBe('today');
    expect(recencyOf(at(2026, 5, 4), now)).toBe('week');
    expect(recencyOf(at(2026, 4, 1), now)).toBe('older');
  });
});
