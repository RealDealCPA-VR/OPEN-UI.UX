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
});
