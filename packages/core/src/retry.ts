/**
 * Parse a Retry-After header value (HTTP spec: either delta-seconds or HTTP-date).
 * Returns the delay in milliseconds, or undefined if unparseable. Negative deltas
 * are clamped to 0; absurdly large deltas (> 1 hour) are capped to keep the UI alive.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    const ms = Math.max(0, seconds * 1000);
    return Math.min(ms, 60 * 60 * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  const delta = dateMs - now;
  if (delta <= 0) return 0;
  return Math.min(delta, 60 * 60 * 1000);
}

export interface BackoffOptions {
  attempt: number;
  baseMs?: number;
  capMs?: number;
  jitter?: () => number;
}

/**
 * Compute exponential backoff with full jitter (AWS-style).
 * attempt is 0-indexed for the first retry.
 */
export function exponentialBackoffMs(opts: BackoffOptions): number {
  const baseMs = opts.baseMs ?? 500;
  const capMs = opts.capMs ?? 30_000;
  const rng = opts.jitter ?? Math.random;
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, opts.attempt));
  return Math.floor(rng() * exp);
}

export interface RetryDelayOptions extends Omit<BackoffOptions, 'attempt'> {
  attempt: number;
  retryAfter?: string | null;
  now?: number;
}

/**
 * Returns the delay (ms) to wait before retrying a request. Honors Retry-After
 * if present and otherwise falls back to exponential backoff with jitter.
 */
export function computeRetryDelayMs(opts: RetryDelayOptions): number {
  const fromHeader = parseRetryAfter(opts.retryAfter, opts.now);
  if (fromHeader !== undefined) return fromHeader;
  return exponentialBackoffMs(opts);
}

export interface RetryableFetchOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  signal?: AbortSignal;
  isRetryable?: (status: number) => boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultRetryable = (status: number): boolean =>
  status === 429 || status === 408 || status === 425 || (status >= 500 && status < 600);

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Wraps a fetch-returning thunk with retry/backoff. Retries 429/408/5xx by
 * default (up to 3 attempts total); honors Retry-After from the response.
 * Pass `maxAttempts: 1` to opt out of retries entirely.
 */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryableFetchOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const isRetryable = opts.isRetryable ?? defaultRetryable;
  const sleep = opts.sleep ?? defaultSleep;
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await doFetch();
    if (response.ok || !isRetryable(response.status)) return response;
    lastResponse = response;
    if (attempt === maxAttempts - 1) break;
    const retryAfter = response.headers.get('retry-after');
    const delay = computeRetryDelayMs({
      attempt,
      retryAfter,
      ...(opts.baseMs !== undefined ? { baseMs: opts.baseMs } : {}),
      ...(opts.capMs !== undefined ? { capMs: opts.capMs } : {}),
    });
    try {
      await response.body?.cancel();
    } catch {
      // ignore — body may already be consumed
    }
    await sleep(delay, opts.signal);
  }
  return lastResponse as Response;
}
