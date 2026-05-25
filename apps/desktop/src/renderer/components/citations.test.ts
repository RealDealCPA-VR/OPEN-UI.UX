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
  });

  it('extracts file:line:col citations', () => {
    const out = tokenizeCitations('error at src/index.ts:5:12 — type mismatch');
    expect(out[1]).toMatchObject({
      kind: 'citation',
      file: 'src/index.ts',
      line: 5,
    });
  });

  it('handles back-to-back citations', () => {
    const out = tokenizeCitations('compare a.ts:1 and b.ts:2');
    const citations = out.filter((t) => t.kind === 'citation');
    expect(citations.length).toBe(2);
  });
});
