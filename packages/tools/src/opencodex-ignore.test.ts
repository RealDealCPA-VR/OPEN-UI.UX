import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher, parseIgnoreFile } from './opencodex-ignore';

describe('parseIgnoreFile', () => {
  it('skips comments + blank lines', () => {
    const rules = parseIgnoreFile('# a comment\n\nnode_modules\n');
    expect(rules.length).toBe(1);
  });

  it('handles negation', () => {
    const rules = parseIgnoreFile('*.log\n!keep.log\n');
    const matcher = createIgnoreMatcher(rules);
    expect(matcher.matches('app.log')).toBe(true);
    expect(matcher.matches('keep.log')).toBe(false);
  });

  it('anchored patterns only match root', () => {
    const rules = parseIgnoreFile('/dist\n');
    const matcher = createIgnoreMatcher(rules);
    expect(matcher.matches('dist')).toBe(true);
    expect(matcher.matches('packages/foo/dist')).toBe(false);
  });

  it('non-anchored patterns match anywhere', () => {
    const rules = parseIgnoreFile('node_modules\n');
    const matcher = createIgnoreMatcher(rules);
    expect(matcher.matches('node_modules')).toBe(true);
    expect(matcher.matches('apps/web/node_modules')).toBe(true);
  });

  it('double-star matches across directories', () => {
    const rules = parseIgnoreFile('**/build\n');
    const matcher = createIgnoreMatcher(rules);
    expect(matcher.matches('build')).toBe(true);
    expect(matcher.matches('packages/foo/build')).toBe(true);
  });
});
