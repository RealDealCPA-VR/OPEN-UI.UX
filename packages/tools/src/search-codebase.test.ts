import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, rankSearchHits, reciprocalRankFusion } from './search-codebase';

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
