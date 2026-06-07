import { describe, expect, it } from 'vitest';
import { jaroWinkler } from './jaro-winkler';

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', '')).toBe(1);
  });

  it('returns 0 for fully disjoint strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('abc', '')).toBe(0);
  });

  it('matches the canonical MARTHA/MARHTA reference (~0.961)', () => {
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.9611, 3);
  });

  it('matches the canonical DWAYNE/DUANE reference (~0.84)', () => {
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2);
  });

  it('matches the canonical DIXON/DICKSONX reference (~0.813)', () => {
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.8133, 3);
  });

  it('is symmetric', () => {
    expect(jaroWinkler('hello', 'hallo')).toBeCloseTo(jaroWinkler('hallo', 'hello'), 10);
  });

  it('rewards a shared prefix', () => {
    expect(jaroWinkler('prefix_match', 'prefix_other')).toBeGreaterThan(
      jaroWinkler('xrefix_match', 'yrefix_other'),
    );
  });

  it('stays within [0, 1]', () => {
    const pairs: Array<[string, string]> = [
      ['getUserName', 'get_user_name'],
      ['a', 'ab'],
      ['foobar', 'barfoo'],
    ];
    for (const [a, b] of pairs) {
      const score = jaroWinkler(a, b);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
