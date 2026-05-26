import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetListenerForTests,
  buildTriggerUrl,
  RATE_LIMIT_WINDOW_MS,
  SIGNATURE_HEADER,
  startListener,
  stopListener,
  type ListenerCallback,
  type TaskSecretLookup,
} from './listener';

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

async function post(
  port: number,
  taskId: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const url = buildTriggerUrl(taskId, port);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

describe('scheduler listener', () => {
  beforeEach(() => {
    __resetListenerForTests();
  });

  afterEach(async () => {
    await stopListener();
    __resetListenerForTests();
  });

  it('binds in the configured port range', async () => {
    const lookup: TaskSecretLookup = () => ({ kind: 'webhook', secret: 'sekret' });
    const onTrigger: ListenerCallback = vi.fn();
    const info = await startListener({
      rangeStart: 38940,
      rangeEnd: 38944,
      lookupTaskSecret: lookup,
      onTrigger,
    });
    expect(info).not.toBeNull();
    expect(info!.port).toBeGreaterThanOrEqual(38940);
    expect(info!.port).toBeLessThanOrEqual(38944);
  });

  it('falls back to the next port when the preferred one is busy', async () => {
    // Hold the preferred port with a raw http server BEFORE starting the
    // listener under test. The listener should iterate past it into the range.
    const { createServer } = await import('node:http');
    const blocker = createServer();
    const PREFERRED = 39100;
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(PREFERRED, '127.0.0.1', () => resolve());
    });

    try {
      const info = await startListener({
        preferredPort: PREFERRED,
        rangeStart: 39101,
        rangeEnd: 39110,
        lookupTaskSecret: () => ({ kind: 'webhook', secret: 's' }),
        onTrigger: () => undefined,
      });
      expect(info).not.toBeNull();
      expect(info!.port).not.toBe(PREFERRED);
      expect(info!.port).toBeGreaterThanOrEqual(39101);
      expect(info!.port).toBeLessThanOrEqual(39110);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('accepts a properly signed POST and invokes onTrigger', async () => {
    const lookup: TaskSecretLookup = (id) =>
      id === 'task-1' ? { kind: 'webhook', secret: 'super-secret' } : null;
    const onTrigger = vi.fn().mockResolvedValue(undefined);
    const info = await startListener({
      rangeStart: 38960,
      rangeEnd: 38969,
      lookupTaskSecret: lookup,
      onTrigger,
    });
    expect(info).not.toBeNull();
    const body = JSON.stringify({ hello: 'world' });
    const sig = sign('super-secret', body);

    const res = await post(info!.port, 'task-1', body, {
      [SIGNATURE_HEADER]: sig,
    });
    expect(res.status).toBe(202);
    expect(onTrigger).toHaveBeenCalledOnce();
    const call = onTrigger.mock.calls[0]?.[0];
    expect(call?.taskId).toBe('task-1');
    expect(call?.kind).toBe('webhook');
    expect(call?.body).toEqual({ hello: 'world' });
  });

  it('rejects a tampered body with 401', async () => {
    const lookup: TaskSecretLookup = () => ({ kind: 'webhook', secret: 'abc' });
    const onTrigger = vi.fn();
    const info = await startListener({
      rangeStart: 38970,
      rangeEnd: 38979,
      lookupTaskSecret: lookup,
      onTrigger,
    });
    expect(info).not.toBeNull();
    const body = JSON.stringify({ ok: true });
    const sig = sign('abc', body);

    const res = await post(info!.port, 'task-x', '{"tampered":true}', {
      [SIGNATURE_HEADER]: sig,
    });
    expect(res.status).toBe(401);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('rejects when secret does not match', async () => {
    const lookup: TaskSecretLookup = () => ({ kind: 'webhook', secret: 'right-secret' });
    const onTrigger = vi.fn();
    const info = await startListener({
      rangeStart: 38980,
      rangeEnd: 38989,
      lookupTaskSecret: lookup,
      onTrigger,
    });
    expect(info).not.toBeNull();
    const body = JSON.stringify({ ok: true });
    const sig = sign('wrong-secret', body);

    const res = await post(info!.port, 'task-x', body, {
      [SIGNATURE_HEADER]: sig,
    });
    expect(res.status).toBe(401);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('rejects when signature header is missing', async () => {
    const lookup: TaskSecretLookup = () => ({ kind: 'webhook', secret: 'abc' });
    const info = await startListener({
      rangeStart: 38990,
      rangeEnd: 38999,
      lookupTaskSecret: lookup,
      onTrigger: vi.fn(),
    });
    expect(info).not.toBeNull();
    const res = await post(info!.port, 'task-x', '{}');
    expect(res.status).toBe(401);
  });

  it('rejects unknown task with 404', async () => {
    const lookup: TaskSecretLookup = () => null;
    const info = await startListener({
      rangeStart: 39000,
      rangeEnd: 39009,
      lookupTaskSecret: lookup,
      onTrigger: vi.fn(),
    });
    expect(info).not.toBeNull();
    const body = '{}';
    const sig = sign('whatever', body);
    const res = await post(info!.port, 'nope', body, { [SIGNATURE_HEADER]: sig });
    expect(res.status).toBe(404);
  });

  it('rejects non-POST methods', async () => {
    const info = await startListener({
      rangeStart: 39010,
      rangeEnd: 39019,
      lookupTaskSecret: () => null,
      onTrigger: vi.fn(),
    });
    expect(info).not.toBeNull();
    const res = await fetch(buildTriggerUrl('x', info!.port), { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('rejects non-JSON content-type', async () => {
    const info = await startListener({
      rangeStart: 39020,
      rangeEnd: 39029,
      lookupTaskSecret: () => ({ kind: 'webhook', secret: 's' }),
      onTrigger: vi.fn(),
    });
    expect(info).not.toBeNull();
    const res = await fetch(buildTriggerUrl('x', info!.port), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status).toBe(415);
  });

  it('rate-limits a flood of requests for the same task to 1/sec', async () => {
    const lookup: TaskSecretLookup = () => ({ kind: 'webhook', secret: 's' });
    const onTrigger = vi.fn().mockResolvedValue(undefined);
    const info = await startListener({
      rangeStart: 39030,
      rangeEnd: 39039,
      lookupTaskSecret: lookup,
      onTrigger,
    });
    expect(info).not.toBeNull();
    const body = '{}';
    const sig = sign('s', body);

    const r1 = await post(info!.port, 'task-rl', body, { [SIGNATURE_HEADER]: sig });
    expect(r1.status).toBe(202);

    const r2 = await post(info!.port, 'task-rl', body, { [SIGNATURE_HEADER]: sig });
    expect(r2.status).toBe(429);

    expect(onTrigger).toHaveBeenCalledOnce();
    void RATE_LIMIT_WINDOW_MS;
  });
});
