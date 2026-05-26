import { describe, expect, it } from 'vitest';
import { abortSpawnedRun } from './spawn-from-ui';

describe('abortSpawnedRun', () => {
  it('returns false for unknown run ids', () => {
    expect(abortSpawnedRun('does-not-exist')).toBe(false);
  });
});
