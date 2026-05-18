import type { ProviderTestResult } from '../../shared/provider-config';
import type { PingSpec } from './catalog';

export interface PingOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function ping(spec: PingSpec, options: PingOptions = {}): Promise<ProviderTestResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetchImpl(spec.url, {
      method: spec.method,
      headers: spec.headers,
      signal: ctrl.signal,
    });
    if (resp.ok) {
      return {
        ok: true,
        code: 'ok',
        message: `Reachable (HTTP ${resp.status})`,
        httpStatus: resp.status,
      };
    }
    if (resp.status === 401 || resp.status === 403) {
      return {
        ok: false,
        code: 'auth',
        message: `Authentication failed (HTTP ${resp.status})`,
        httpStatus: resp.status,
      };
    }
    return {
      ok: false,
      code: 'http',
      message: `HTTP ${resp.status}`,
      httpStatus: resp.status,
    };
  } catch (err) {
    if (ctrl.signal.aborted) {
      return { ok: false, code: 'timeout', message: `Timed out after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      code: 'network',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
