import { z } from 'zod';
import { defineTool, type Tool } from '@opencodex/core';
import { NotionApiError, NotionClient, type NotionClientOptions } from './client';
import {
  appendBlockResponseSchema,
  blockChildrenResponseSchema,
  createPageResponseSchema,
  databaseObjectSchema,
  pageObjectSchema,
  richTextSchema,
  searchResponseSchema,
  userSchema,
} from './schemas';
import { buildParagraphBlock, renderBlockToMarkdown, richTextToPlain } from './blocks';

export { NotionApiError, NotionClient };
export type { NotionClientOptions };

export interface NotionMemoryOptions {
  token: string;
  workspaceName?: string;
  fetchImpl?: typeof fetch;
  toolNamePrefix?: string;
  clientOptions?: Omit<NotionClientOptions, 'token' | 'fetchImpl'>;
}

export interface NotionSearchHit {
  id: string;
  type: 'page' | 'database';
  title: string;
  url: string | null;
  lastEditedTime: string | null;
}

export interface NotionPageContent {
  id: string;
  title: string;
  url: string | null;
  lastEditedTime: string | null;
  content: string;
  properties: Record<string, string>;
}

export interface NotionTestConnectionResult {
  ok: boolean;
  error?: string;
  user?: { name: string };
}

const searchInputSchema = z.object({
  query: z.string().min(1).describe('Notion search query'),
  filter: z.enum(['page', 'database']).optional().describe('Restrict to pages or databases only'),
});

const readPageInputSchema = z.object({
  pageId: z.string().min(1).describe('Notion page ID (with or without dashes)'),
});

const appendBlockInputSchema = z.object({
  pageId: z.string().min(1).describe('Notion page ID to append to'),
  content: z.string().min(1).describe('Plain text to append as a paragraph block'),
});

const createPageInputSchema = z.object({
  parentPageId: z.string().min(1).describe('Parent page ID under which to create the new page'),
  title: z.string().min(1).describe('Title of the new page'),
  content: z.string().optional().describe('Optional body paragraph to add under the title'),
});

function extractTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as { type?: unknown; title?: unknown };
    if (rec.type === 'title' && Array.isArray(rec.title)) {
      const text = richTextToPlain(rec.title);
      if (text.length > 0) return text;
    }
  }
  return 'Untitled';
}

function extractDatabaseTitle(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'Untitled database';
  const title = (raw as { title?: unknown }).title;
  const parsed = richTextSchema.safeParse(title ?? []);
  if (!parsed.success) return 'Untitled database';
  const text = parsed.data
    .map((p) => p.plain_text ?? p.text?.content ?? '')
    .join('')
    .trim();
  return text.length > 0 ? text : 'Untitled database';
}

function summarizeProperties(properties: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as { type?: unknown };
    const type = typeof rec.type === 'string' ? rec.type : undefined;
    if (!type) continue;
    const detail = (value as Record<string, unknown>)[type];
    out[key] = summarizePropertyValue(type, detail);
  }
  return out;
}

function summarizePropertyValue(type: string, detail: unknown): string {
  switch (type) {
    case 'title':
    case 'rich_text':
      return richTextToPlain(detail);
    case 'number':
      return typeof detail === 'number' ? String(detail) : '';
    case 'select':
      if (detail && typeof detail === 'object') {
        return String((detail as { name?: unknown }).name ?? '');
      }
      return '';
    case 'status':
      if (detail && typeof detail === 'object') {
        return String((detail as { name?: unknown }).name ?? '');
      }
      return '';
    case 'multi_select':
      if (Array.isArray(detail)) {
        return (detail as Array<{ name?: unknown }>)
          .map((d) => String(d.name ?? ''))
          .filter((s) => s.length > 0)
          .join(', ');
      }
      return '';
    case 'checkbox':
      return detail ? 'true' : 'false';
    case 'date': {
      if (!detail || typeof detail !== 'object') return '';
      const start = String((detail as { start?: unknown }).start ?? '');
      const end = (detail as { end?: unknown }).end;
      if (typeof end === 'string' && end.length > 0) return `${start}..${end}`;
      return start;
    }
    case 'url':
      return typeof detail === 'string' ? detail : '';
    case 'email':
      return typeof detail === 'string' ? detail : '';
    case 'phone_number':
      return typeof detail === 'string' ? detail : '';
    case 'created_time':
    case 'last_edited_time':
      return typeof detail === 'string' ? detail : '';
    case 'created_by':
    case 'last_edited_by':
      if (detail && typeof detail === 'object') {
        const name = (detail as { name?: unknown }).name;
        const id = (detail as { id?: unknown }).id;
        return typeof name === 'string' && name.length > 0
          ? name
          : typeof id === 'string'
            ? id
            : '';
      }
      return '';
    case 'people':
      if (Array.isArray(detail)) {
        return (detail as Array<{ name?: unknown; id?: unknown }>)
          .map((p) =>
            typeof p.name === 'string' && p.name.length > 0 ? p.name : String(p.id ?? ''),
          )
          .filter((s) => s.length > 0)
          .join(', ');
      }
      return '';
    case 'files':
      if (Array.isArray(detail)) {
        return (detail as Array<{ name?: unknown }>)
          .map((f) => String(f.name ?? ''))
          .filter((s) => s.length > 0)
          .join(', ');
      }
      return '';
    case 'relation':
      if (Array.isArray(detail)) {
        return (detail as Array<{ id?: unknown }>)
          .map((r) => String(r.id ?? ''))
          .filter((s) => s.length > 0)
          .join(', ');
      }
      return JSON.stringify({ type, raw: detail });
    case 'rollup': {
      if (!detail || typeof detail !== 'object') return '';
      const inner = detail as Record<string, unknown>;
      const innerType = typeof inner['type'] === 'string' ? (inner['type'] as string) : '';
      if (innerType === 'number' && typeof inner['number'] === 'number') {
        return String(inner['number']);
      }
      if (innerType === 'date') {
        return summarizePropertyValue('date', inner['date']);
      }
      if (innerType === 'array' && Array.isArray(inner['array'])) {
        return (inner['array'] as unknown[])
          .map((item) => {
            if (!item || typeof item !== 'object') return '';
            const itemType = (item as { type?: unknown }).type;
            if (typeof itemType !== 'string') return '';
            return summarizePropertyValue(itemType, (item as Record<string, unknown>)[itemType]);
          })
          .filter((s) => s.length > 0)
          .join(', ');
      }
      return JSON.stringify({ type, raw: detail });
    }
    case 'formula': {
      if (!detail || typeof detail !== 'object') return '';
      const inner = detail as Record<string, unknown>;
      const innerType = typeof inner['type'] === 'string' ? (inner['type'] as string) : '';
      if (innerType === 'string' && typeof inner['string'] === 'string') return inner['string'];
      if (innerType === 'number' && typeof inner['number'] === 'number') {
        return String(inner['number']);
      }
      if (innerType === 'boolean') return inner['boolean'] ? 'true' : 'false';
      if (innerType === 'date') return summarizePropertyValue('date', inner['date']);
      return JSON.stringify({ type, raw: detail });
    }
    case 'unique_id': {
      if (!detail || typeof detail !== 'object') return '';
      const number = (detail as { number?: unknown }).number;
      const prefix = (detail as { prefix?: unknown }).prefix;
      const numStr = typeof number === 'number' ? String(number) : '';
      const prefixStr = typeof prefix === 'string' ? prefix : '';
      return prefixStr.length > 0 && numStr.length > 0
        ? `${prefixStr}-${numStr}`
        : numStr || prefixStr;
    }
    case 'verification': {
      if (!detail || typeof detail !== 'object') return '';
      return String((detail as { state?: unknown }).state ?? '');
    }
    default:
      return JSON.stringify({ type, raw: detail });
  }
}

export class NotionMemory {
  private readonly client: NotionClient;
  readonly workspaceName: string | undefined;
  private readonly toolNamePrefix: string;

  constructor(opts: NotionMemoryOptions) {
    const clientOpts: NotionClientOptions = { token: opts.token, ...opts.clientOptions };
    if (opts.fetchImpl) clientOpts.fetchImpl = opts.fetchImpl;
    this.client = new NotionClient(clientOpts);
    if (opts.workspaceName !== undefined) this.workspaceName = opts.workspaceName;
    this.toolNamePrefix = opts.toolNamePrefix ?? 'memory__notion__';
  }

  async testConnection(): Promise<NotionTestConnectionResult> {
    try {
      const raw = await this.client.request('GET', '/users/me');
      const parsed = userSchema.safeParse(raw);
      const name =
        parsed.success && typeof parsed.data.name === 'string' && parsed.data.name.length > 0
          ? parsed.data.name
          : 'Notion integration';
      return { ok: true, user: { name } };
    } catch (err) {
      if (err instanceof NotionApiError && err.status === 401) {
        return { ok: false, error: 'Unauthorized — check your Notion integration token' };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  buildTools(): Tool[] {
    const prefix = this.toolNamePrefix;
    const tools: Tool[] = [];
    tools.push(
      defineTool({
        name: `${prefix}notion_search`,
        description:
          'Search Notion for pages or databases by title. Returns a ranked list of hits with IDs.',
        inputZod: searchInputSchema,
        permissionTier: 'read',
        execute: async ({ query, filter }): Promise<NotionSearchHit[]> => {
          return this.search(query, filter);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}notion_read_page`,
        description:
          'Read a Notion page: title, properties, and a markdown-ish flattening of its top-level blocks.',
        inputZod: readPageInputSchema,
        permissionTier: 'read',
        execute: async ({ pageId }): Promise<NotionPageContent> => {
          return this.readPage(pageId);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}notion_append_block`,
        description:
          'Append a single paragraph block to a Notion page. Markdown formatting is not parsed.',
        inputZod: appendBlockInputSchema,
        permissionTier: 'write',
        execute: async ({ pageId, content }): Promise<{ ok: true; appendedCount: number }> => {
          return this.appendBlock(pageId, content);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}notion_create_page`,
        description:
          'Create a new Notion page under a parent page, with a title and optional body paragraph.',
        inputZod: createPageInputSchema,
        permissionTier: 'write',
        execute: async ({
          parentPageId,
          title,
          content,
        }): Promise<{ id: string; url: string | null }> => {
          return this.createPage(parentPageId, title, content);
        },
      }) as unknown as Tool,
    );
    return tools;
  }

  async search(
    query: string,
    filter?: 'page' | 'database',
    opts: { maxResults?: number; pageSize?: number } = {},
  ): Promise<NotionSearchHit[]> {
    const maxResults = opts.maxResults ?? 100;
    const pageSize = Math.min(opts.pageSize ?? 100, 100);
    const hits: NotionSearchHit[] = [];
    let cursor: string | undefined;
    for (;;) {
      const body: Record<string, unknown> = { query, page_size: pageSize };
      if (filter) body['filter'] = { value: filter, property: 'object' };
      if (cursor) body['start_cursor'] = cursor;
      const raw = await this.client.request('POST', '/search', body);
      const parsed = searchResponseSchema.parse(raw);
      for (const result of parsed.results) {
        const page = pageObjectSchema.safeParse(result);
        if (page.success) {
          hits.push({
            id: page.data.id,
            type: 'page',
            title: extractTitle(page.data.properties),
            url: page.data.url ?? null,
            lastEditedTime: page.data.last_edited_time ?? null,
          });
          if (hits.length >= maxResults) return hits;
          continue;
        }
        const db = databaseObjectSchema.safeParse(result);
        if (db.success) {
          hits.push({
            id: db.data.id,
            type: 'database',
            title: extractDatabaseTitle(db.data),
            url: db.data.url ?? null,
            lastEditedTime: db.data.last_edited_time ?? null,
          });
          if (hits.length >= maxResults) return hits;
        }
      }
      if (!parsed.next_cursor || parsed.has_more === false) break;
      cursor = parsed.next_cursor;
    }
    return hits;
  }

  async readPage(pageId: string, opts: { maxBlocks?: number } = {}): Promise<NotionPageContent> {
    const id = encodeURIComponent(pageId);
    const pageRaw = await this.client.request('GET', `/pages/${id}`);
    const page = pageObjectSchema.parse(pageRaw);
    const maxBlocks = opts.maxBlocks ?? 1000;
    const lines: string[] = [];
    let cursor: string | undefined;
    let collected = 0;
    for (;;) {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);
      const childrenRaw = await this.client.request(
        'GET',
        `/blocks/${id}/children?${qs.toString()}`,
      );
      const children = blockChildrenResponseSchema.parse(childrenRaw);
      for (const block of children.results) {
        const rendered = renderBlockToMarkdown(block);
        if (rendered.length > 0) lines.push(rendered);
        collected++;
        if (collected >= maxBlocks) {
          return {
            id: page.id,
            title: extractTitle(page.properties),
            url: page.url ?? null,
            lastEditedTime: page.last_edited_time ?? null,
            content: lines.join('\n\n'),
            properties: summarizeProperties(page.properties),
          };
        }
      }
      if (!children.next_cursor || children.has_more === false) break;
      cursor = children.next_cursor;
    }
    return {
      id: page.id,
      title: extractTitle(page.properties),
      url: page.url ?? null,
      lastEditedTime: page.last_edited_time ?? null,
      content: lines.join('\n\n'),
      properties: summarizeProperties(page.properties),
    };
  }

  async appendBlock(pageId: string, content: string): Promise<{ ok: true; appendedCount: number }> {
    const id = encodeURIComponent(pageId);
    const body = { children: [buildParagraphBlock(content)] };
    const raw = await this.client.request('PATCH', `/blocks/${id}/children`, body);
    const parsed = appendBlockResponseSchema.parse(raw);
    return { ok: true, appendedCount: parsed.results.length };
  }

  async createPage(
    parentPageId: string,
    title: string,
    content?: string,
  ): Promise<{ id: string; url: string | null }> {
    const children: Array<Record<string, unknown>> = [];
    if (content && content.length > 0) {
      children.push(buildParagraphBlock(content));
    }
    const body: Record<string, unknown> = {
      parent: { type: 'page_id', page_id: parentPageId },
      properties: {
        title: {
          title: [
            {
              type: 'text',
              text: { content: title },
            },
          ],
        },
      },
    };
    if (children.length > 0) body['children'] = children;
    const raw = await this.client.request('POST', '/pages', body);
    const parsed = createPageResponseSchema.parse(raw);
    return { id: parsed.id, url: parsed.url ?? null };
  }
}
