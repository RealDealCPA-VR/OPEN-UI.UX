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
    expect(children).toHaveLength(1);
    const properties = body['properties'] as Record<string, unknown>;
    expect(properties['title']).toBeDefined();
  });

  it('omits children when no body content is provided', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'page',
          id: 'np-2',
          url: 'https://notion.so/np-2',
          properties: {},
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    await mem.createPage('parent-1', 'Title only');
    const body = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as Record<string, unknown>;
    expect(body['children']).toBeUndefined();
  });
});

describe('NotionApiError mapping', () => {
  it('throws NotionApiError on non-2xx after retries are exhausted', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          { status: 429 },
        ),
      () =>
        new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          { status: 429 },
        ),
      () =>
        new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          { status: 429 },
        ),
      () =>
        new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          { status: 429 },
        ),
    ]);
    const mem = new NotionMemory({
      token: 't',
      fetchImpl,
      clientOptions: { sleepImpl: async () => undefined },
    });
    await expect(mem.search('x')).rejects.toBeInstanceOf(NotionApiError);
  });
});

describe('NotionClient retry behavior', () => {
  it('retries on 429 and succeeds on subsequent attempt', async () => {
    let calls = 0;
    const { fetchImpl } = makeMockFetch([
      () => {
        calls++;
        return new Response(
          JSON.stringify({ object: 'error', code: 'rate_limited', message: 'slow down' }),
          {
            status: 429,
            headers: { 'retry-after': '0' },
          },
        );
      },
      () => {
        calls++;
        return jsonResponse({ object: 'list', results: [], next_cursor: null });
      },
    ]);
    const mem = new NotionMemory({
      token: 't',
      fetchImpl,
      clientOptions: { sleepImpl: async () => undefined },
    });
    const r = await mem.search('q');
    expect(r).toEqual([]);
    expect(calls).toBe(2);
  });

  it('retries on 5xx errors', async () => {
    let calls = 0;
    const { fetchImpl } = makeMockFetch([
      () => {
        calls++;
        return new Response('boom', { status: 503 });
      },
      () => {
        calls++;
        return jsonResponse({ object: 'list', results: [], next_cursor: null });
      },
    ]);
    const mem = new NotionMemory({
      token: 't',
      fetchImpl,
      clientOptions: { sleepImpl: async () => undefined },
    });
    await mem.search('q');
    expect(calls).toBe(2);
  });

  it('does not retry on 4xx errors other than 429', async () => {
    let calls = 0;
    const { fetchImpl } = makeMockFetch([
      () => {
        calls++;
        return new Response(
          JSON.stringify({ object: 'error', code: 'validation_error', message: 'bad' }),
          { status: 400 },
        );
      },
    ]);
    const mem = new NotionMemory({
      token: 't',
      fetchImpl,
      clientOptions: { sleepImpl: async () => undefined },
    });
    await expect(mem.search('q')).rejects.toBeInstanceOf(NotionApiError);
    expect(calls).toBe(1);
  });
});

describe('NotionMemory.search pagination', () => {
  it('follows next_cursor until exhausted', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'page',
              id: 'p1',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ type: 'text', plain_text: 'one', text: { content: 'one' } }],
                },
              },
            },
          ],
          next_cursor: 'cursor-2',
          has_more: true,
        }),
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'page',
              id: 'p2',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ type: 'text', plain_text: 'two', text: { content: 'two' } }],
                },
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const hits = await mem.search('q');
    expect(hits.map((h) => h.id)).toEqual(['p1', 'p2']);
    const secondBody = JSON.parse(String(calls[1]?.init?.body ?? '{}')) as Record<string, unknown>;
    expect(secondBody['start_cursor']).toBe('cursor-2');
  });

  it('stops at maxResults', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'page',
              id: 'p1',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ type: 'text', plain_text: 'a', text: { content: 'a' } }],
                },
              },
            },
            {
              object: 'page',
              id: 'p2',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ type: 'text', plain_text: 'b', text: { content: 'b' } }],
                },
              },
            },
          ],
          next_cursor: 'c2',
          has_more: true,
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const hits = await mem.search('q', undefined, { maxResults: 1 });
    expect(hits).toHaveLength(1);
  });
});

describe('NotionMemory.readPage pagination', () => {
  it('paginates block children', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'page',
          id: 'p1',
          properties: {
            Name: {
              type: 'title',
              title: [{ type: 'text', plain_text: 'P', text: { content: 'P' } }],
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
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', plain_text: 'one', text: { content: 'one' } }],
              },
            },
          ],
          next_cursor: 'c-next',
          has_more: true,
        }),
      () =>
        jsonResponse({
          object: 'list',
          results: [
            {
              object: 'block',
              id: 'b2',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', plain_text: 'two', text: { content: 'two' } }],
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const r = await mem.readPage('p1');
    expect(r.content).toContain('one');
    expect(r.content).toContain('two');
    expect(calls[2]?.url).toContain('start_cursor=c-next');
  });
});

describe('NotionMemory.readPage property summarization', () => {
  it('summarizes number, date range, people, relation, formula', async () => {
    const { fetchImpl } = makeMockFetch([
      () =>
        jsonResponse({
          object: 'page',
          id: 'p1',
          properties: {
            Count: { type: 'number', number: 42 },
            When: { type: 'date', date: { start: '2025-01-01', end: '2025-01-31' } },
            Owners: {
              type: 'people',
              people: [
                { id: 'u1', name: 'Alice' },
                { id: 'u2', name: 'Bob' },
              ],
            },
            Linked: {
              type: 'relation',
              relation: [{ id: 'rel-1' }, { id: 'rel-2' }],
            },
            Calc: { type: 'formula', formula: { type: 'string', string: 'computed' } },
            Status: { type: 'status', status: { name: 'In progress' } },
            Email: { type: 'email', email: 'a@b.c' },
            Unknown: { type: 'mystery', mystery: { foo: 'bar' } },
          },
        }),
      () => jsonResponse({ object: 'list', results: [], next_cursor: null }),
    ]);
    const mem = new NotionMemory({ token: 't', fetchImpl });
    const r = await mem.readPage('p1');
    expect(r.properties['Count']).toBe('42');
    expect(r.properties['When']).toBe('2025-01-01..2025-01-31');
    expect(r.properties['Owners']).toBe('Alice, Bob');
    expect(r.properties['Linked']).toBe('rel-1, rel-2');
    expect(r.properties['Calc']).toBe('computed');
    expect(r.properties['Status']).toBe('In progress');
    expect(r.properties['Email']).toBe('a@b.c');
    expect(r.properties['Unknown']).toBeDefined();
    expect(r.properties['Unknown']).toContain('mystery');
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
