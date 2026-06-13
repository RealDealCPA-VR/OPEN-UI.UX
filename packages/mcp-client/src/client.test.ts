import { describe, expect, it, vi } from 'vitest';
import { McpClient, UnsupportedProtocolVersionError } from './client';
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './protocol';
import type { Transport, TransportKind } from './transport';

type MessageHandler = (msg: unknown) => void;
type CloseHandler = () => void;

interface MockTransport extends Transport {
  pushIncoming(msg: unknown): void;
  outgoing: unknown[];
  stopCalls: number;
}

function makeMockTransport(): MockTransport {
  let messageHandler: MessageHandler | null = null;
  let closeHandler: CloseHandler | null = null;
  const outgoing: unknown[] = [];
  const transport: MockTransport = {
    kind: 'http' as TransportKind,
    outgoing,
    stopCalls: 0,
    async start() {
      // no-op
    },
    async stop() {
      transport.stopCalls += 1;
      closeHandler?.();
    },
    async send(message) {
      outgoing.push(message);
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    pushIncoming(msg) {
      messageHandler?.(msg);
    },
  };
  return transport;
}

describe('McpClient', () => {
  it('initializes and emits initialized notification', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
      }
    })();

    const connect = client.connect();
    // Wait for initialize request to be sent
    await new Promise((r) => setTimeout(r, 10));
    expect(transport.outgoing[0]).toMatchObject({
      method: 'initialize',
      jsonrpc: '2.0',
    });
    const initId = (transport.outgoing[0] as { id: number }).id;
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: initId,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'mock', version: '1.0' },
        capabilities: {},
      },
    });
    await connect;

    expect(client.info?.serverInfo.name).toBe('mock');
    expect(transport.outgoing[1]).toMatchObject({ method: 'notifications/initialized' });
  });

  it('advertises the newest supported protocol version in initialize', async () => {
    expect(PROTOCOL_VERSION).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
    expect(PROTOCOL_VERSION).toBe('2025-06-18');

    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
      }
    })();

    const connect = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(transport.outgoing[0]).toMatchObject({
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });

    const initId = (transport.outgoing[0] as { id: number }).id;
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: initId,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'mock', version: '1.0' },
        capabilities: {},
      },
    });
    await connect;
    expect(client.info?.protocolVersion).toBe('2025-06-18');
  });

  it('rejects unsupported protocol versions during connect', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
      }
    })();

    const connect = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const initId = (transport.outgoing[0] as { id: number }).id;
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: initId,
      result: {
        protocolVersion: '1999-01-01',
        serverInfo: { name: 'mock', version: '1.0' },
        capabilities: {},
      },
    });

    await expect(connect).rejects.toBeInstanceOf(UnsupportedProtocolVersionError);
    expect(transport.stopCalls).toBe(1);
    expect(client.isConnected()).toBe(false);
  });

  it('stops the transport when initialize returns a JSON-RPC error', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
      }
    })();

    const connect = client.connect();
    await vi.waitFor(() => expect(transport.outgoing.length).toBe(1));
    const initId = (transport.outgoing[0] as { id: number }).id;
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: initId,
      error: { code: -32603, message: 'init exploded' },
    });

    await expect(connect).rejects.toThrow('init exploded');
    expect(transport.stopCalls).toBe(1);
    expect(client.isConnected()).toBe(false);
  });

  it('stops the transport when the initialize result fails schema validation', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
      }
    })();

    const connect = client.connect();
    await vi.waitFor(() => expect(transport.outgoing.length).toBe(1));
    const initId = (transport.outgoing[0] as { id: number }).id;
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: initId,
      result: { notTheShape: true },
    });

    await expect(connect).rejects.toThrow();
    expect(transport.stopCalls).toBe(1);
    expect(client.isConnected()).toBe(false);
  });

  it('supports multiple onClose and onNotification listeners', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        transport.onClose(() => {
          const listeners = (this as unknown as { closeListeners: (() => void)[] }).closeListeners;
          for (const l of listeners) l();
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    const closes: number[] = [];
    client.onClose(() => closes.push(1));
    client.onClose(() => closes.push(2));

    const notes: string[] = [];
    client.onNotification((method) => notes.push(`a:${method}`));
    client.onNotification((method) => notes.push(`b:${method}`));

    transport.pushIncoming({ jsonrpc: '2.0', method: 'note/x', params: {} });
    expect(notes).toEqual(['a:note/x', 'b:note/x']);

    await client.disconnect();
    expect(closes).toEqual([1, 2]);
  });

  it('replies with method-not-found when no handler is registered for server requests', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();
    expect(client.isConnected()).toBe(true);

    transport.pushIncoming({
      jsonrpc: '2.0',
      id: 99,
      method: 'sampling/createMessage',
      params: {},
    });

    await new Promise((r) => setTimeout(r, 5));
    const reply = transport.outgoing[0] as {
      id: number;
      error: { code: number; message: string };
    };
    expect(reply.id).toBe(99);
    expect(reply.error.code).toBe(-32601);
  });

  it('routes registered server requests to handler', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    client.setServerRequestHandler('sampling/createMessage', () => ({ ok: true }));

    transport.pushIncoming({
      jsonrpc: '2.0',
      id: 7,
      method: 'sampling/createMessage',
      params: {},
    });

    await new Promise((r) => setTimeout(r, 5));
    const reply = transport.outgoing[0] as { id: number; result: { ok: boolean } };
    expect(reply.id).toBe(7);
    expect(reply.result).toEqual({ ok: true });
  });

  it('emits notifications/cancelled when a request times out', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    type ReqFn = (m: string, p: unknown, t?: number) => Promise<unknown>;
    const requestFn = (client as unknown as { request: ReqFn }).request;
    const promise = requestFn.call(client, 'slow/method', {}, 20);
    await expect(promise).rejects.toThrow(/timed out/);
    const cancelled = transport.outgoing.find(
      (m): m is { method: string; params: { requestId: number } } => {
        if (typeof m !== 'object' || m === null) return false;
        const obj = m as { method?: unknown };
        return obj.method === 'notifications/cancelled';
      },
    );
    expect(cancelled).toBeDefined();
    expect(cancelled?.params.requestId).toBeTypeOf('number');
  });

  it('routes tool/list response by id', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    const promise = client.listTools();
    await new Promise((r) => setTimeout(r, 5));
    const sent = transport.outgoing[0] as { id: number };
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: sent.id,
      result: { tools: [{ name: 'echo', description: 'echo back' }] },
    });
    const tools = await promise;
    expect(tools).toEqual([{ name: 'echo', description: 'echo back' }]);
  });

  it('follows nextCursor across pages when listing tools', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    const promise = client.listTools();
    await vi.waitFor(() => expect(transport.outgoing.length).toBe(1));
    const first = transport.outgoing[0] as { id: number; method: string; params: unknown };
    expect(first.method).toBe('tools/list');
    expect(first.params).toEqual({});
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: first.id,
      result: { tools: [{ name: 'page1-tool' }], nextCursor: 'cursor-1' },
    });

    await vi.waitFor(() => expect(transport.outgoing.length).toBe(2));
    const second = transport.outgoing[1] as { id: number; method: string; params: unknown };
    expect(second.method).toBe('tools/list');
    expect(second.params).toEqual({ cursor: 'cursor-1' });
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: second.id,
      result: { tools: [{ name: 'page2-tool' }] },
    });

    const tools = await promise;
    expect(tools.map((t) => t.name)).toEqual(['page1-tool', 'page2-tool']);
  });

  it('stops paginating when a server repeats the same cursor', async () => {
    const transport = makeMockTransport();
    const client = new (class extends McpClient {
      constructor() {
        super('test', { kind: 'stdio', command: 'noop', args: [] });
        (this as unknown as { transport: Transport }).transport = transport;
        transport.onMessage((msg) => {
          (this as unknown as { handleMessage: (m: unknown) => void }).handleMessage(msg);
        });
        (this as unknown as { connected: boolean }).connected = true;
      }
    })();

    const promise = client.listResources();
    await vi.waitFor(() => expect(transport.outgoing.length).toBe(1));
    const first = transport.outgoing[0] as { id: number };
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: first.id,
      result: {
        resources: [{ uri: 'res://a', name: 'a' }],
        nextCursor: 'loop',
      },
    });

    await vi.waitFor(() => expect(transport.outgoing.length).toBe(2));
    const second = transport.outgoing[1] as { id: number };
    transport.pushIncoming({
      jsonrpc: '2.0',
      id: second.id,
      result: {
        resources: [{ uri: 'res://b', name: 'b' }],
        nextCursor: 'loop',
      },
    });

    const resources = await promise;
    expect(resources.map((r) => r.name)).toEqual(['a', 'b']);
    expect(transport.outgoing.length).toBe(2);
  });
});
