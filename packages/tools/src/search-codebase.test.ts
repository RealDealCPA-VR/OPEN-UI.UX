import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './search-codebase';

describe('reciprocalRankFusion', () => {
  it('boosts items that rank high in multiple lists', () => {
    const a = ['x', 'y', 'z'];
    const b = ['z', 'x', 'y'];
    const fused = reciprocalRankFusion([a, b], (s) => s);
    expect(fused[0]).toBe('x');
  });

  it('handles empty rankings', () => {
    expect(reciprocalRankFusion<string>([], (s) => s)).toEqual([]);
  });

  it('treats k as a smoothing constant', () => {
    const a = ['x'];
    const b = ['y'];
    const fused = reciprocalRankFusion([a, b], (s) => s, 1);
    // Both at rank 0 with k=1 → 1/2 score each; order stable
    expect(fused.length).toBe(2);
  });
});
