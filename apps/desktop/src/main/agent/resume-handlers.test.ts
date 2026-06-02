import { describe, expect, it, vi, beforeEach } from 'vitest';

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

const consumePendingResume = vi.fn<[string], boolean>();
const markStatus = vi.fn();

vi.mock('./run-resume', () => ({
  consumePendingResume: (runId: string) => consumePendingResume(runId),
}));

vi.mock('./run-store', () => ({
  markStatus: (...args: unknown[]) => markStatus(...args),
}));

const { registerResumeHandlers } = await import('./resume-handlers');

function getHandler(): IpcHandlerFn {
  const call = handleSpy.mock.calls.find(([channel]) => channel === 'agent:respond-resume');
  expect(call).toBeDefined();
  return call![1];
}

beforeEach(() => {
  handleSpy.mockReset();
  consumePendingResume.mockReset();
  markStatus.mockReset();
  consumePendingResume.mockReturnValue(true);
});

describe('registerResumeHandlers', () => {
  it('registers agent:respond-resume on ipcMain', () => {
    registerResumeHandlers();
    expect(handleSpy.mock.calls.some(([channel]) => channel === 'agent:respond-resume')).toBe(true);
  });

  it('rejects invocations from a non-main frame (iframe/webview)', async () => {
    registerResumeHandlers();
    const fn = getHandler();
    await expect(
      fn(
        { senderFrame: { parent: { url: 'evil' }, url: 'https://evil' } },
        { runId: 'r1', decision: 'discard' },
      ),
    ).rejects.toThrow(/main frame/);
    expect(consumePendingResume).not.toHaveBeenCalled();
    expect(markStatus).not.toHaveBeenCalled();
  });

  it('discards the run when invoked from the main frame', async () => {
    registerResumeHandlers();
    const fn = getHandler();
    const result = await fn(
      { senderFrame: { parent: null, url: 'file:///app' } },
      { runId: 'r1', decision: 'discard' },
    );
    expect(result).toEqual({ ok: true });
    expect(consumePendingResume).toHaveBeenCalledWith('r1');
    expect(markStatus).toHaveBeenCalledWith('r1', 'failed', 'runner_error', expect.any(Number));
  });

  it('rejects malformed payloads via the shared validation', async () => {
    registerResumeHandlers();
    const fn = getHandler();
    await expect(
      fn({ senderFrame: { parent: null, url: 'file:///app' } }, { runId: '', decision: 'nope' }),
    ).rejects.toThrow(/invalid request/);
    expect(consumePendingResume).not.toHaveBeenCalled();
  });
});
