import { describe, expect, it } from 'vitest';
import { slugifyConversationTitle } from './git-workflow';

describe('slugifyConversationTitle', () => {
  it('lowercases and replaces whitespace', () => {
    expect(slugifyConversationTitle('Hello World')).toBe('hello-world');
  });

  it('returns untitled for blank input', () => {
    expect(slugifyConversationTitle('   ')).toBe('untitled');
    expect(slugifyConversationTitle('!!!')).toBe('untitled');
  });

  it('strips punctuation', () => {
    expect(slugifyConversationTitle('Fix: bug in foo.ts!')).toBe('fix-bug-in-foots');
  });

  it('collapses multiple dashes', () => {
    expect(slugifyConversationTitle('a---b___c')).toBe('a-b-c');
  });

  it('caps length at 48 chars', () => {
    const long = 'a'.repeat(200);
    const result = slugifyConversationTitle(long);
    expect(result.length).toBeLessThanOrEqual(48);
  });

  it('trims leading/trailing dashes', () => {
    expect(slugifyConversationTitle('-foo-')).toBe('foo');
  });
});
