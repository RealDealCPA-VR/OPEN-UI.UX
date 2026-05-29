import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

type IpcHandlerFn = (
  event: { senderFrame?: { parent: unknown; url: string } | null },
  raw: unknown,
) => Promise<unknown> | unknown;

const handleSpy = vi.fn<[string, IpcHandlerFn], void>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: IpcHandlerFn) => handleSpy(channel, fn),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { registerInvoke, emit } = await import('./registry');

beforeEach(() => {
  handleSpy.mockReset();
});

describe('registerInvoke senderFrame guard', () => {
  it('dispatches when senderFrame.parent is null (main frame)', async () => {
    const handler = vi.fn(() => 'ok');
    registerInvoke('app:version' as never, z.unknown() as never, handler as never);
    const fn = handleSpy.mock.calls[0]?.[1];
    expect(fn).toBeDefined();
    const result = await fn!({ senderFrame: { parent: null, url: 'file:///x' } }, undefined);
    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects when senderFrame.parent is non-null (iframe / sub-frame)', async () => {
    const handler = vi.fn(() => 'ok');
    registerInvoke('app:version' as never, z.unknown() as never, handler as never);
    const fn = handleSpy.mock.calls[0]?.[1];
    await expect(
      fn!({ senderFrame: { parent: { url: 'evil' }, url: 'https://evil' } }, undefined),
    ).rejects.toThrow(/main frame/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still dispatches if senderFrame is missing (e.g. test stubs)', async () => {
    const handler = vi.fn(() => 'ok');
    registerInvoke('app:version' as never, z.unknown() as never, handler as never);
    const fn = handleSpy.mock.calls[0]?.[1];
    const result = await fn!({}, undefined);
    expect(result).toBe('ok');
  });
});

describe('emit() destroyed-webContents guard', () => {
  it('no-ops if webContents.isDestroyed() returns true', () => {
    const send = vi.fn();
    const wc = { isDestroyed: () => true, send } as unknown as Electron.WebContents;
    emit(wc, 'workspace:changed' as never, { workspaces: [] } as never);
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards send() when webContents is live', () => {
    const send = vi.fn();
    const wc = { isDestroyed: () => false, send } as unknown as Electron.WebContents;
    emit(wc, 'workspace:changed' as never, { workspaces: [] } as never);
    expect(send).toHaveBeenCalledWith('workspace:changed', { workspaces: [] });
  });
});
