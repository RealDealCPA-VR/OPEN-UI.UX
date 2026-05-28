import { describe, expect, it } from 'vitest';
import { tokenizeCitations } from './citations';

describe('tokenizeCitations', () => {
  it('returns a single text token when nothing matches', () => {
    const out = tokenizeCitations('no citations here');
    expect(out).toEqual([{ kind: 'text', text: 'no citations here' }]);
  });

  it('extracts a file:line citation', () => {
    const out = tokenizeCitations('see packages/core/src/provider.ts:29 for details');
    expect(out.length).toBe(3);
    expect(out[1]).toMatchObject({
      kind: 'citation',
      file: 'packages/core/src/provider.ts',
      line: 29,
    });
    expect(out[1]?.endLine).toBeUndefined();
  });

  it('extracts file:line:col citations', () => {
    const out = tokenizeCitations('error at src/index.ts:5:12 — type mismatch');
    expect(out[1]).toMatchObject({
      kind: 'citation',
      file: 'src/index.ts',
      line: 5,
    });
    expect(out[1]?.endLine).toBeUndefined();
  });

  it('extracts file:line-line range citations', () => {
    const out = tokenizeCitations('look at src/foo.ts:10-24 carefully');
    const citation = out.find((t) => t.kind === 'citation');
    expect(citation).toMatchObject({
      kind: 'citation',
      file: 'src/foo.ts',
      line: 10,
      endLine: 24,
    });
  });

  it('ignores a reversed range (end < start)', () => {
    const out = tokenizeCitations('see src/foo.ts:40-10 someday');
    const citation = out.find((t) => t.kind === 'citation');
    expect(citation?.line).toBe(40);
    expect(citation?.endLine).toBeUndefined();
  });

  it('handles back-to-back citations', () => {
    const out = tokenizeCitations('compare a.ts:1 and b.ts:2');
    const citations = out.filter((t) => t.kind === 'citation');
    expect(citations.length).toBe(2);
  });

  it('handles a mix of single, col, and range citations', () => {
    const out = tokenizeCitations('a.ts:1 b.ts:2:3 c.ts:4-7');
    const citations = out.filter((t) => t.kind === 'citation');
    expect(citations.length).toBe(3);
    expect(citations[0]?.endLine).toBeUndefined();
    expect(citations[1]?.endLine).toBeUndefined();
    expect(citations[2]?.endLine).toBe(7);
  });
});
