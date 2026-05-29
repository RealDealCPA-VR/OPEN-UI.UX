import { describe, expect, it } from 'vitest';
import { sanitizeErrorDetail } from './safe-detail';

describe('sanitizeErrorDetail', () => {
  it('redacts Bearer tokens in Authorization headers', () => {
    const out = sanitizeErrorDetail('Authorization: Bearer sk-livefoo1234567890');
    expect(out).not.toContain('sk-livefoo1234567890');
    expect(out).toMatch(/redacted/);
  });

  it('redacts x-api-key style headers', () => {
    const out = sanitizeErrorDetail('x-api-key: abcd1234efgh5678ijkl');
    expect(out).not.toContain('abcd1234efgh5678ijkl');
    expect(out).toMatch(/redacted/);
  });

  it('redacts OpenAI sk- keys anywhere', () => {
    const out = sanitizeErrorDetail('Error: invalid key sk-livefoo1234567890abc');
    expect(out).not.toContain('sk-livefoo1234567890abc');
  });

  it('truncates large bodies to the byte cap', () => {
    const long = 'x'.repeat(10_000);
    const out = sanitizeErrorDetail(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/truncated/);
  });

  it('leaves short safe text alone', () => {
    expect(sanitizeErrorDetail('rate limit exceeded')).toBe('rate limit exceeded');
  });
});
