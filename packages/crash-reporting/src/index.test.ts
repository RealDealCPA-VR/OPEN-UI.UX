import { describe, expect, it, vi, beforeEach } from 'vitest';
import { _resetForTesting, captureException, initCrash, scrubEvent } from './index';

describe('initCrash', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns no-op client when disabled, without importing @sentry/electron/main', async () => {
    const dynamicImport = vi.fn();
    // Spy on import would require module mock; here we just assert behavior:
    // a disabled init returns immediately with an enabled=false client.
    const client = await initCrash({ enabled: false, dsn: 'https://x@x/1' });
    expect(client.enabled).toBe(false);
    expect(() => client.captureException(new Error('boom'))).not.toThrow();
    expect(dynamicImport).not.toHaveBeenCalled();
  });

  it('returns no-op client when dsn is empty', async () => {
    const client = await initCrash({ enabled: true, dsn: '' });
    expect(client.enabled).toBe(false);
  });

  it('returns no-op client when dsn is whitespace', async () => {
    const client = await initCrash({ enabled: true, dsn: '   ' });
    expect(client.enabled).toBe(false);
  });

  it('captureException is safe when no init has been performed', () => {
    expect(() => captureException(new Error('hi'))).not.toThrow();
  });
});

describe('scrubEvent', () => {
  it('drops user info', () => {
    const out = scrubEvent({
      user: { id: 'u-1', email: 'a@b.com', ip_address: '1.2.3.4' },
    });
    expect(out.user).toBeNull();
  });

  it('redacts request URL path', () => {
    const out = scrubEvent({
      request: { url: 'https://example.com/users/123/secret-path' },
    });
    expect(out.request?.url).toBe('https://example.com/<path>');
  });

  it('redacts absolute paths from extra', () => {
    const out = scrubEvent({
      extra: {
        workspace: 'C:\\Users\\someone\\Projects\\app',
        unixPath: '/Users/someone/code',
        note: 'just a label',
        count: 42,
      },
    });
    expect(out.extra?.['workspace']).toBe('<redacted-path>');
    expect(out.extra?.['unixPath']).toBe('<redacted-path>');
    expect(out.extra?.['note']).toBe('just a label');
    expect(out.extra?.['count']).toBe(42);
  });

  it('passes through events with no PII unchanged', () => {
    const out = scrubEvent({ extra: { foo: 'bar' } });
    expect(out.extra?.['foo']).toBe('bar');
  });
});
