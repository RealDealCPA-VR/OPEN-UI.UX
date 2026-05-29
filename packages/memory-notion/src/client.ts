import { notionErrorSchema } from './schemas';

const DEFAULT_BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export class NotionApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly body: unknown,
  ) {
    super(`Notion API ${status}${code ? ` (${code})` : ''}: ${message}`);
    this.name = 'NotionApiError';
  }
}

export interface NotionClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  notionVersion?: string;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NotionClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly notionVersion: string;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: NotionClientOptions) {
    if (!opts.token || opts.token.length === 0) {
      throw new Error('Notion token is required');
    }
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.notionVersion = opts.notionVersion ?? NOTION_VERSION;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.sleep = opts.sleepImpl ?? defaultSleep;
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'notion-version': this.notionVersion,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let lastErr: NotionApiError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.fetchImpl(url, init);
      if (res.ok) return res.json();

      const raw = await res.text().catch(() => '');
      let parsed: unknown;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        parsed = raw;
      }
      const errInfo = notionErrorSchema.safeParse(parsed);
      const message = errInfo.success
        ? (errInfo.data.message ?? `HTTP ${res.status}`)
        : raw || `HTTP ${res.status}`;
      const code = errInfo.success ? errInfo.data.code : undefined;
      const err = new NotionApiError(res.status, code, message, parsed ?? raw);
      lastErr = err;

      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retriable || attempt === this.maxRetries) {
        throw err;
      }

      const retryAfter = res.headers.get('retry-after');
      const delay = computeRetryDelay(retryAfter, attempt, this.baseRetryDelayMs);
      await this.sleep(delay);
    }
    throw lastErr ?? new NotionApiError(0, undefined, 'unknown error', undefined);
  }
}

export function computeRetryDelay(
  retryAfterHeader: string | null,
  attempt: number,
  baseMs: number,
): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.floor(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfterHeader);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  const expo = baseMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * baseMs);
  return expo + jitter;
}
