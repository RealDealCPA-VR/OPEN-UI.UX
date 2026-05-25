import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StdioTransport } from './stdio-transport';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperJs = path.resolve(here, '..', 'test-fixtures', 'echo-server.cjs');

describe('StdioTransport', () => {
  it('starts a child process, sends a message, and receives a JSON-RPC reply', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: [helperJs],
      env: {},
    });

    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));

    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await transport.stop();

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toMatchObject({ jsonrpc: '2.0', id: 1 });
  });

  it('handles process close', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: {},
    });

    const closed = new Promise<void>((resolve) => transport.onClose(() => resolve()));
    await transport.start();
    await closed;
    expect(true).toBe(true);
  });
});
