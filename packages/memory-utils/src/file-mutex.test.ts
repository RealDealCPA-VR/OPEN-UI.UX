import { describe, expect, it } from 'vitest';
import { withFileLock } from './file-mutex';

describe('withFileLock', () => {
  it('serializes async functions sharing a key', async () => {
    const events: string[] = [];
    const work = (label: string, delay: number): Promise<void> =>
      withFileLock('shared', async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, delay));
        events.push(`end:${label}`);
      });
    await Promise.all([work('a', 30), work('b', 5), work('c', 1)]);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('allows parallel work for different keys', async () => {
    let active = 0;
    let peak = 0;
    const work = (key: string): Promise<void> =>
      withFileLock(key, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      });
    await Promise.all([work('x'), work('y'), work('z')]);
    expect(peak).toBe(3);
  });

  it('releases the lock after a rejection', async () => {
    const order: string[] = [];
    const failing = withFileLock('k', async () => {
      order.push('fail-start');
      throw new Error('boom');
    });
    const following = failing
      .catch(() => undefined)
      .then(() =>
        withFileLock('k', async () => {
          order.push('after');
        }),
      );
    await following;
    expect(order).toEqual(['fail-start', 'after']);
  });

  it('returns the function value', async () => {
    const result = await withFileLock('r', async () => 42);
    expect(result).toBe(42);
  });
});
