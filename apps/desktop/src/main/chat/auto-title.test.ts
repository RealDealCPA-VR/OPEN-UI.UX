import { describe, expect, it } from 'vitest';
import { buildTitleMessages, sanitizeTitle } from './auto-title';

describe('sanitizeTitle', () => {
  it('takes the first non-empty line', () => {
    expect(sanitizeTitle('\n\nFix Login Bug\nmore text')).toBe('Fix Login Bug');
  });

  it('strips surrounding quotes, backticks and markdown', () => {
    expect(sanitizeTitle('"Refactor Auth"')).toBe('Refactor Auth');
    expect(sanitizeTitle('**Add Dark Mode**')).toBe('Add Dark Mode');
    expect(sanitizeTitle('`Cache Layer`')).toBe('Cache Layer');
    expect(sanitizeTitle('# Heading Title')).toBe('Heading Title');
  });

  it('collapses whitespace and drops trailing punctuation', () => {
    expect(sanitizeTitle('Improve   Search.')).toBe('Improve Search');
    expect(sanitizeTitle('Why does this break?')).toBe('Why does this break');
  });

  it('caps length to 60 chars', () => {
    expect(sanitizeTitle('a'.repeat(100)).length).toBe(60);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeTitle('   \n  ')).toBe('');
  });
});

describe('buildTitleMessages', () => {
  it('produces a single tool-free user message containing both sides', () => {
    const msgs = buildTitleMessages('how do I add auth', 'You can use sessions');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.role).toBe('user');
    const content = msgs[0]?.content;
    expect(typeof content).toBe('string');
    expect(content as string).toContain('how do I add auth');
    expect(content as string).toContain('You can use sessions');
  });

  it('truncates very long inputs to 800 chars', () => {
    const longUser = 'u'.repeat(2000);
    const content = buildTitleMessages(longUser, '')[0]?.content as string;
    // The user portion is capped at 800 chars: exactly 800 consecutive 'u's
    // appear, but not 801.
    expect(content).toContain('u'.repeat(800));
    expect(content).not.toContain('u'.repeat(801));
  });
});
