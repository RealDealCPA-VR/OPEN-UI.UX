import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHostAllowed, webFetchTool } from './web-fetch';
import { makeCtx } from './test-helpers';

const ctx = () => makeCtx('/tmp');

describe('isHostAllowed', () => {
  it('matches exact host', () => {
    expect(isHostAllowed('api.example.com', ['api.example.com'])).toBe(true);
    expect(isHostAllowed('other.example.com', ['api.example.com'])).toBe(false);
  });

  it('matches wildcard subdomain', () => {
    expect(isHostAllowed('api.example.com', ['*.example.com'])).toBe(true);
    expect(isHostAllowed('deep.api.example.com', ['*.example.com'])).toBe(true);
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(true);
    expect(isHostAllowed('notexample.com', ['*.example.com'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isHostAllowed('API.EXAMPLE.COM', ['api.example.com'])).toBe(true);
  });

  it('rejects when allowlist is empty', () => {
    expect(isHostAllowed('api.example.com', [])).toBe(false);
  });
});

describe('webFetchTool', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('denies host not in allowlist', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    await expect(webFetchTool.execute({ url: 'https://evil.com/path' }, ctx())).rejects.toThrow(
      /not in the allowlist/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies non-http(s) protocols', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', '*');
    await expect(webFetchTool.execute({ url: 'file:///etc/passwd' }, ctx())).rejects.toThrow(
      /unsupported protocol/,
    );
  });

  it('denies all hosts when allowlist is empty', async () => {
    await expect(webFetchTool.execute({ url: 'https://api.example.com' }, ctx())).rejects.toThrow(
      /not in the allowlist/,
    );
  });

  it('returns status, headers, body, contentType', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'yes' },
      }),
    );
    const result = await webFetchTool.execute({ url: 'https://api.example.com/v1' }, ctx());
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.truncated).toBe(false);
    expect(result.contentType).toBe('application/json');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-custom']).toBe('yes');
  });

  it('truncates body at maxResponseBytes', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    const big = 'x'.repeat(2000);
    fetchMock.mockResolvedValueOnce(new Response(big));
    const result = await webFetchTool.execute(
      { url: 'https://api.example.com', maxResponseBytes: 100 },
      ctx(),
    );
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(100);
  });

  it('forwards method, headers, and body', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await webFetchTool.execute(
      {
        url: 'https://api.example.com/v1',
        method: 'POST',
        headers: { 'x-token': 'abc' },
        body: '{"hello":"world"}',
      },
      ctx(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-token': 'abc' },
        body: '{"hello":"world"}',
      }),
    );
  });

  it('supports wildcard allowlist for subdomains', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', '*.github.com');
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const result = await webFetchTool.execute(
      { url: 'https://api.github.com/repos/foo/bar' },
      ctx(),
    );
    expect(result.status).toBe(200);
  });

  it('aborts when ctx.signal fires (AbortSignal.any composes both signals)', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const sig = init.signal;
          if (!sig) return;
          if (sig.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          });
        }),
    );

    const ac = new AbortController();
    const callCtx = { ...makeCtx('/tmp'), signal: ac.signal };
    const promise = webFetchTool.execute({ url: 'https://api.example.com/slow' }, callCtx);
    setTimeout(() => ac.abort(), 20);
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('aborts when timeout fires even if ctx.signal stays alive', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const sig = init.signal;
          if (!sig) return;
          sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          });
        }),
    );

    await expect(
      webFetchTool.execute({ url: 'https://api.example.com/slow', timeoutMs: 30 }, ctx()),
    ).rejects.toThrow(/abort/i);
  });

  it('blocks a redirect to a host outside the allowlist (SSRF guard)', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } }),
    );
    await expect(
      webFetchTool.execute({ url: 'https://api.example.com/redir' }, ctx()),
    ).rejects.toThrow(/blocked redirect to non-allowlisted host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to a cloud-metadata IP', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', 'api.example.com');
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );
    await expect(
      webFetchTool.execute({ url: 'https://api.example.com/redir' }, ctx()),
    ).rejects.toThrow(/blocked redirect/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to an allowlisted host', async () => {
    vi.stubEnv('OPENCODEX_WEB_FETCH_ALLOWLIST', '*.example.com');
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/final' },
        }),
      )
      .mockResolvedValueOnce(new Response('landed', { status: 200 }));
    const result = await webFetchTool.execute({ url: 'https://api.example.com/start' }, ctx());
    expect(result.status).toBe(200);
    expect(result.body).toBe('landed');
    expect(result.finalUrl).toBe('https://cdn.example.com/final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
