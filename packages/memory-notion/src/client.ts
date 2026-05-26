import { notionErrorSchema } from './schemas';

const DEFAULT_BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

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
}

export class NotionClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly notionVersion: string;

  constructor(opts: NotionClientOptions) {
    if (!opts.token || opts.token.length === 0) {
      throw new Error('Notion token is required');
    }
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.notionVersion = opts.notionVersion ?? NOTION_VERSION;
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
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
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
      throw new NotionApiError(res.status, code, message, parsed ?? raw);
    }
    return res.json();
  }
}
