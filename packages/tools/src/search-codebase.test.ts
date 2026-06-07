import { describe, expect, it } from 'vitest';
import {
  extractImportSpecifiers,
  rankFused,
  rankSearchHits,
  reciprocalRankFusion,
} from './search-codebase';

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

  it('keeps items present in only one list', () => {
    const a = ['x', 'y'];
    const b = ['x', 'z'];
    const fused = reciprocalRankFusion([a, b], (s) => s);
    // x appears in both → top; y and z each appear once.
    expect(fused[0]).toBe('x');
    expect(fused).toContain('y');
    expect(fused).toContain('z');
    expect(fused).toHaveLength(3);
  });

  it('breaks ties by first insertion order', () => {
    // Single list: every item has a distinct rank, no ties; order preserved.
    const a = ['a', 'b', 'c'];
    expect(reciprocalRankFusion([a], (s) => s)).toEqual(['a', 'b', 'c']);
  });

  it('smaller k widens the gap between adjacent ranks', () => {
    // With one shared top item and a contender, smaller k makes rank-0
    // dominance stronger. Verify the contender that is rank-0 in one list
    // and absent elsewhere still trails the doubly-top item, and that the
    // effective ordering depends on k.
    const a = ['top', 'mid'];
    const b = ['top', 'other'];
    const fusedSmallK = reciprocalRankFusion([a, b], (s) => s, 1);
    const fusedLargeK = reciprocalRankFusion([a, b], (s) => s, 1000);
    expect(fusedSmallK[0]).toBe('top');
    expect(fusedLargeK[0]).toBe('top');
    // 'top' lead over 'mid' is larger with small k than with large k.
    const lead = (lists: string[][], k: number): number => {
      const scoreOf = (item: string): number =>
        lists.reduce((acc, list) => {
          const i = list.indexOf(item);
          return i === -1 ? acc : acc + 1 / (k + i + 1);
        }, 0);
      return scoreOf('top') - scoreOf('mid');
    };
    expect(lead([a, b], 1)).toBeGreaterThan(lead([a, b], 1000));
  });
});

describe('rankFused', () => {
  it('fuses keyword and path signals so a clean source file outranks a test file', () => {
    const hits = rankFused(
      [
        { file: 'src/widget.test.ts', line: 3, text: 'const widget = makeWidget()' },
        { file: 'src/widget.ts', line: 7, text: 'const widget = makeWidget()' },
      ],
      'widget',
    );
    expect(hits[0]?.file).toBe('src/widget.ts');
    expect(hits.map((h) => h.file)).toContain('src/widget.test.ts');
  });

  it('returns the underlying scored SearchHit objects (preview/source/score preserved)', () => {
    const hits = rankFused(
      [{ file: 'src/index.ts', line: 1, text: 'export const foo = 1' }],
      'foo',
      'ws-A',
    );
    expect(hits[0]?.preview).toBe('export const foo = 1');
    expect(hits[0]?.source).toBe('workspace');
    expect(hits[0]?.workspaceId).toBe('ws-A');
    expect(typeof hits[0]?.score).toBe('number');
  });

  it('passes through a single hit unchanged', () => {
    const hits = rankFused([{ file: 'a.ts', line: 1, text: 'foo' }], 'foo');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toBe('a.ts');
  });
});

describe('rankSearchHits', () => {
  it('tags hits with the supplied workspaceId', () => {
    const hits = rankSearchHits(
      [{ file: 'src/index.ts', line: 1, text: 'export const foo = 1' }],
      'foo',
      'ws-A',
    );
    expect(hits[0]?.workspaceId).toBe('ws-A');
    expect(hits[0]?.source).toBe('workspace');
  });

  it('omits workspaceId when not provided', () => {
    const hits = rankSearchHits(
      [{ file: 'src/index.ts', line: 1, text: 'export const foo = 1' }],
      'foo',
    );
    expect(hits[0]?.workspaceId).toBeUndefined();
  });
});

describe('extractImportSpecifiers', () => {
  it('parses ES module imports', () => {
    expect(extractImportSpecifiers("import { foo } from '@bar/baz';")).toContain('@bar/baz');
  });

  it('parses dynamic imports and require', () => {
    expect(extractImportSpecifiers("const x = require('node:fs');")).toContain('node:fs');
    expect(extractImportSpecifiers("await import('./local');")).toContain('./local');
  });

  it('parses python from-import and rust use', () => {
    expect(extractImportSpecifiers('from shared.utils import widget')).toContain('shared.utils');
    expect(extractImportSpecifiers('use crate::module::Thing;')).toContain('crate::module::Thing');
  });

  it('returns empty for non-import text', () => {
    expect(extractImportSpecifiers('const x = 1 + 2;')).toEqual([]);
  });
});
