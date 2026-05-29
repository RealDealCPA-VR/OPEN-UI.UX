import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { validateDeepLink } = await import('./deep-link');

describe('validateDeepLink', () => {
  it('accepts a well-formed opencodex:// URL', () => {
    expect(validateDeepLink('opencodex://share/abc?token=xyz', 'opencodex')).toBe(
      'opencodex://share/abc?token=xyz',
    );
  });

  it('rejects wrong protocol', () => {
    expect(validateDeepLink('https://share/abc', 'opencodex')).toBeNull();
    expect(validateDeepLink('file:///etc/passwd', 'opencodex')).toBeNull();
    expect(validateDeepLink('javascript:alert(1)', 'opencodex')).toBeNull();
  });

  it('rejects non-URL strings', () => {
    expect(validateDeepLink('not a url', 'opencodex')).toBeNull();
    expect(validateDeepLink('', 'opencodex')).toBeNull();
  });

  it('rejects URLs over the length cap', () => {
    const long = 'opencodex://share/' + 'a'.repeat(3000);
    expect(validateDeepLink(long, 'opencodex')).toBeNull();
  });

  it('normalizes URL even when input contains characters URL escapes', () => {
    const out = validateDeepLink('opencodex://share/has<bracket>', 'opencodex');
    expect(out).not.toBeNull();
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('allows percent-encoded characters', () => {
    expect(validateDeepLink('opencodex://share/has%20space', 'opencodex')).toBe(
      'opencodex://share/has%20space',
    );
  });
});
