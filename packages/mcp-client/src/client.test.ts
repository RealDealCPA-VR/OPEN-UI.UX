import { describe, expect, it } from 'vitest';
import { McpClient } from './client';
import type { Transport, TransportKind } from './transport';

type MessageHandler = (msg: unknown) => void;
type CloseHandler = () => void;

interface MockTransport extends Transport {
  pushIncoming(msg: unknown): void;
  outgoing: unknown[];
}

function makeMockTransport(): MockTransport {
  let messageHandler: MessageHandler | null = null;
  let closeHandler: CloseHandler | null = null;
  const outgoing: unknown[] = [];
  const transport: MockTransport = {
    kind: 'http' as TransportKind,
    outgoing,
    async start() {
      // no-op
    },
    async stop() {
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
});
