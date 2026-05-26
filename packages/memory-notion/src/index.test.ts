import { describe, expect, it } from 'vitest';
import { NotionApiError, NotionMemory } from './index';

interface MockCall {
  url: string;
  init?: RequestInit;
}

function makeMockFetch(handlers: Array<(call: MockCall) => Promise<Response> | Response>): {
  fetchImpl: typeof fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let i = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: MockCall = { url };
    if (init !== undefined) call.init = init;
    calls.push(call);
    const handler = handlers[i++];
    if (!handler) throw new Error(`unexpected fetch call #${calls.length} to ${url}`);
    return handler(call);
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('NotionMemory.testConnection', () => {
  it('returns ok with user name', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () => jsonResponse({ object: 'user', id: 'u', name: 'Alice', type: 'person' }),
    ]);
    const mem = new NotionMemory({ token: 'tok', fetchImpl });
    const r = await mem.testConnection();
    expect(r.ok).toBe(true);
    expect(r.user?.name).toBe('Alice');
    expect(calls[0]?.url).toContain('/users/me');
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer tok',
      'notion-version': '2022-06-28',
    });
  });

  it('returns 401 error message', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        new Response(
          JSON.stringify({
            object: 'error',
            status: 401,
            code: 'unauthorized',
            message: 'API token is invalid.',
          }),
          { status: 401 },
        ),
    ]);
    const mem = new NotionMemory({ token: 'bad', fetchImpl });
    const r = await mem.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unauthorized/i);
  });
});

describe('NotionMemory.search', () => {
  it('parses page hits', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'page',
              id: 'page-1',
              url: 'https://notion.so/p1',
              last_edited_time: '2025-01-01T00:00:00.000Z',
              properties: {
                Name: {
                  type: 'title',
                  title: [
                    { type: 'text', plain_text: 'Hello world', text: { content: 'Hello world' } },
                  ],
                },
              },
            },
          ],
          next_cursor: null,
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const hits = await mem.search('hello');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 'page-1',
      type: 'page',
      title: 'Hello world',
      url: 'https://notion.so/p1',
    });
    expect(calls[0]?.url).toContain('/search');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('passes filter through to API', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () => jsonResponse({ object: 'list', results: [], next_cursor: null }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    await mem.search('x', 'database');
    const body = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as Record<string, unknown>;
    expect(body['filter']).toEqual({ value: 'database', property: 'object' });
  });

  it('throws on malformed top-level response', async () => {
    const { fetchImpl } = makeMockFetch([() => jsonResponse({ not_a: 'list' })]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    await expect(mem.search('q')).rejects.toThrow();
  });
});

describe('NotionMemory.readPage', () => {
  it('returns title, properties, and flattened blocks', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'page',
          id: 'p1',
          url: 'https://notion.so/p1',
          last_edited_time: '2025-01-01T00:00:00.000Z',
          properties: {
            Name: {
              type: 'title',
              title: [{ type: 'text', plain_text: 'My page', text: { content: 'My page' } }],
            },
            Status: {
              type: 'select',
              select: { name: 'Done' },
            },
          },
        }),
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'block',
              id: 'b1',
              type: 'heading_1',
              heading_1: {
                rich_text: [{ type: 'text', plain_text: 'Hello', text: { content: 'Hello' } }],
              },
            },
            {
              object: 'block',
              id: 'b2',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', plain_text: 'World.', text: { content: 'World.' } }],
              },
            },
            {
              object: 'block',
              id: 'b3',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ type: 'text', plain_text: 'Item', text: { content: 'Item' } }],
              },
            },
            {
              object: 'block',
              id: 'b4',
              type: 'mystery_block',
              mystery_block: {},
            },
          ],
          next_cursor: null,
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const r = await mem.readPage('p1');
    expect(r.title).toBe('My page');
    expect(r.properties).toMatchObject({ Status: 'Done' });
    expect(r.content).toContain('# Hello');
    expect(r.content).toContain('World.');
    expect(r.content).toContain('- Item');
    expect(r.content).toContain('[unsupported: mystery_block]');
  });
});

describe('NotionMemory.appendBlock', () => {
  it('sends a paragraph block', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'list',
          results: [{ object: 'block', id: 'b1', type: 'paragraph' }],
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const r = await mem.appendBlock('page-1', 'Hi from agent');
    expect(r.appendedCount).toBe(1);
    expect(calls[0]?.url).toContain('/blocks/page-1/children');
    expect(calls[0]?.init?.method).toBe('PATCH');
    const body = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as { children: unknown[] };
    expect(Array.isArray(body.children)).toBe(true);
    expect(body.children).toHaveLength(1);
  });
});

describe('NotionMemory.createPage', () => {
  it('creates a page with a heading and content', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'page',
          id: 'new-1',
          url: 'https://notion.so/new-1',
          properties: {
            title: { type: 'title', title: [{ type: 'text', plain_text: 'My new page' }] },
          },
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const r = await mem.createPage('parent-1', 'My new page', 'Body');
    expect(r.id).toBe('new-1');
    expect(r.url).toBe('https://notion.so/new-1');
    const body = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as Record<string, unknown>;
    expect(body['parent']).toEqual({ type: 'page_id', page_id: 'parent-1' });
    const children = body['children'] as unknown[];
    expect(children).toHaveLength(2);
  });
});

describe('NotionApiError mapping', () => {
  it('throws NotionApiError on non-2xx', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          {
            status: 429,
          },
        ),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    await expect(mem.search('x')).rejects.toBeInstanceOf(NotionApiError);
  });
});

describe('buildTools', () => {
  it('returns four tools with correct tiers and names', () => {
    const mem = new NotionMemory({ token: 't' });
    const tools = mem.buildTools();
    expect(tools.map((t) => t.name)).toEqual([
      'memory__notion__notion_search',
      'memory__notion__notion_read_page',
      'memory__notion__notion_append_block',
      'memory__notion__notion_create_page',
    ]);
    expect(tools[0]?.permissionTier).toBe('read');
    expect(tools[1]?.permissionTier).toBe('read');
    expect(tools[2]?.permissionTier).toBe('write');
    expect(tools[3]?.permissionTier).toBe('write');
  });
});
