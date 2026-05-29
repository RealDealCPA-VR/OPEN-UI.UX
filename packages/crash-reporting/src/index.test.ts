import { describe, expect, it, vi, beforeEach } from 'vitest';
import { _resetForTesting, captureException, initCrash, scrubEvent } from './index';

describe('initCrash', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns no-op client when disabled, without importing @sentry/electron/main', async () => {
    const dynamicImport = vi.fn();
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

  it('rejects DSNs hosted off the default sentry.io allowlist', async () => {
    const client = await initCrash({
      enabled: true,
      dsn: 'https://abc@malicious.example.com/1',
    });
    expect(client.enabled).toBe(false);
  });

  it('accepts a DSN on a user-provided host allowlist', async () => {
    const client = await initCrash({
      enabled: true,
      dsn: 'https://abc@crash.example.org/1',
      allowedHosts: ['example.org'],
    });
    expect(client.enabled).toBe(false);
  });

  it('captureException is safe when no init has been performed', () => {
    expect(() => captureException(new Error('hi'))).not.toThrow();
  });

  it('rejects garbage config via zod parse', async () => {
    await expect(
      initCrash({ enabled: 'yes' as unknown as boolean, dsn: 'https://x@x/1' }),
    ).rejects.toBeDefined();
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

  it('redacts sensitive request headers', () => {
    const out = scrubEvent({
      request: {
        headers: {
          Authorization: 'Bearer secret-token',
          Cookie: 'session=abc',
          'X-Custom': 'visible-value',
        },
      },
    });
    expect(out.request?.headers?.['Authorization']).toBe('<redacted>');
    expect(out.request?.headers?.['Cookie']).toBe('<redacted>');
    expect(out.request?.headers?.['X-Custom']).toBe('visible-value');
  });

  it('redacts paths embedded in request data', () => {
    const out = scrubEvent({
      request: {
        data: { workspace: 'C:\\Users\\someone\\Projects\\app', note: 'ok' },
      },
    });
    const data = out.request?.data as { workspace: string; note: string };
    expect(data.workspace).toBe('<redacted-path>');
    expect(data.note).toBe('ok');
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

  it('redacts paths inside tags', () => {
    const out = scrubEvent({
      tags: { workspace: '/Users/x/project', kind: 'build' },
    });
    expect(out.tags?.['workspace']).toBe('<redacted-path>');
    expect(out.tags?.['kind']).toBe('build');
  });

  it('redacts paths inside contexts nested values', () => {
    const out = scrubEvent({
      contexts: {
        runtime: { name: 'node', cwd: '/Users/x/project' },
      },
    });
    expect(out.contexts?.['runtime']?.['cwd']).toBe('<redacted-path>');
    expect(out.contexts?.['runtime']?.['name']).toBe('node');
  });

  it('scrubs breadcrumb messages and data', () => {
    const out = scrubEvent({
      breadcrumbs: [{ message: '/Users/x/project/file.ts opened', data: { path: 'C:\\Users\\x' } }],
    });
    expect(out.breadcrumbs?.[0]?.message).toBe('<redacted-path>');
    expect(out.breadcrumbs?.[0]?.data?.['path']).toBe('<redacted-path>');
  });

  it('scrubs the top-level message', () => {
    const out = scrubEvent({ message: '/Users/x/project/secret' });
    expect(out.message).toBe('<redacted-path>');
  });

  it('scrubs exception stack frames and frame vars', () => {
    const out = scrubEvent({
      exception: {
        values: [
          {
            value: '/Users/x/leaked-message',
            stacktrace: {
              frames: [
                {
                  filename: '/Users/x/project/src/main.ts',
                  abs_path: 'C:\\Users\\x\\project\\src\\main.ts',
                  vars: { homeDir: '/Users/x', count: 7 },
                },
              ],
            },
          },
        ],
      },
    });
    const frame = out.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(out.exception?.values?.[0]?.value).toBe('<redacted-path>');
    expect(frame?.filename).toBe('<redacted-path>');
    expect(frame?.abs_path).toBe('<redacted-path>');
    expect(frame?.vars?.['homeDir']).toBe('<redacted-path>');
    expect(frame?.vars?.['count']).toBe(7);
  });
});
