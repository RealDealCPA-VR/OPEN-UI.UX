import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StdioTransport } from './stdio-transport';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperJs = path.resolve(here, '..', 'test-fixtures', 'echo-server.cjs');
const envDumpJs = path.resolve(here, '..', 'test-fixtures', 'env-dump-server.cjs');
const noisyStderrJs = path.resolve(here, '..', 'test-fixtures', 'noisy-stderr-server.cjs');

function firstMessage(transport: StdioTransport, received: unknown[]): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    transport.onMessage((msg) => {
      received.push(msg);
      resolve(msg);
    });
  });
}

describe('StdioTransport', () => {
  it('starts a child process, sends a message, and receives a JSON-RPC reply', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: [helperJs],
      env: {},
    });

    const received: unknown[] = [];
    const reply = firstMessage(transport, received);

    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });

    await expect(reply).resolves.toMatchObject({ jsonrpc: '2.0', id: 1 });
    await transport.stop();

    expect(received.length).toBeGreaterThan(0);
  });

  it('scrubs env — does not forward arbitrary parent env to the child', async () => {
    const SECRET_KEY = 'OPENCODEX_TEST_SECRET_DO_NOT_PASS';
    process.env[SECRET_KEY] = 'leaked-value';
    try {
      const transport = new StdioTransport({
        kind: 'stdio',
        command: process.execPath,
        args: [envDumpJs],
        env: { ALLOWED_KEY: 'allowed-value' },
      });

      const received: unknown[] = [];
      const replyPromise = firstMessage(transport, received);

      await transport.start();
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'env', params: {} });
      const reply = (await replyPromise) as { result: { keys: string[] } };
      await transport.stop();

      expect(reply.result.keys).toContain('ALLOWED_KEY');
      expect(reply.result.keys).not.toContain(SECRET_KEY);
    } finally {
      delete process.env[SECRET_KEY];
    }
  });

  it('drains stderr so a noisy child does not block the pipe', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: [noisyStderrJs],
      env: {},
    });

    const received: unknown[] = [];
    const reply = firstMessage(transport, received);

    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
    await reply;

    expect(received.length).toBeGreaterThan(0);
    expect(transport.getStderrTail()).toContain('LAST_LINE_MARKER');

    await transport.stop();
  });

  it('supports multiple onMessage and onClose listeners', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: [helperJs],
      env: {},
    });

    const a: unknown[] = [];
    const b: unknown[] = [];
    const firstA = new Promise<unknown>((resolve) => {
      transport.onMessage((m) => {
        a.push(m);
        resolve(m);
      });
    });
    transport.onMessage((m) => b.push(m));

    const closes: number[] = [];
    transport.onClose(() => closes.push(1));
    transport.onClose(() => closes.push(2));

    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
    await firstA;
    // stop() awaits the child 'close' event, so close listeners have fired.
    await transport.stop();

    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    expect(closes).toEqual([1, 2]);
  });

  it('stop() resolves only after the child has exited and close handlers ran', async () => {
    const transport = new StdioTransport({
      kind: 'stdio',
      command: process.execPath,
      args: [helperJs],
      env: {},
    });

    let closedBeforeStopResolved = false;
    transport.onClose(() => {
      closedBeforeStopResolved = true;
    });

    await transport.start();
    await transport.stop();
    expect(closedBeforeStopResolved).toBe(true);
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
