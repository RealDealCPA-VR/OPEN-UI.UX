import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredMessage } from '../../shared/conversation';

type IpcHandlerFn = (
  event: { senderFrame?: { parent: unknown; url: string } | null },
  raw: unknown,
) => Promise<unknown> | unknown;

const handleSpy = vi.fn<[string, IpcHandlerFn], void>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: IpcHandlerFn) => handleSpy(channel, fn),
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showSaveDialog: vi.fn() },
}));

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./runner', () => ({
  startChatStream: vi.fn(),
  cancelChatStream: vi.fn(),
  listActiveStreams: vi.fn(() => []),
  getActivePartial: vi.fn(() => null),
}));

vi.mock('./turn-restore', () => ({
  listInterruptedTurns: vi.fn(() => []),
  consumeInterruptedTurn: vi.fn(() => null),
}));

const appendMessage = vi.fn();
vi.mock('../storage/conversations', () => ({
  appendMessage: (req: unknown) => appendMessage(req),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationUsage: vi.fn(),
  listConversations: vi.fn(() => []),
  listMessages: vi.fn(() => []),
  renameConversation: vi.fn(),
  setConversationStarred: vi.fn(),
}));

const { registerChatHandlers } = await import('./handlers');

function getHandler(channel: string): IpcHandlerFn {
  const call = handleSpy.mock.calls.find(([c]) => c === channel);
  expect(call).toBeDefined();
  return call![1];
}

const mainFrameEvent = { senderFrame: null };

const storedRow: StoredMessage = {
  id: 'm1',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'hi',
  contentBlocks: null,
  providerId: null,
  modelId: null,
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
  createdAt: '2026-01-01T00:00:00Z',
  turnStatus: 'final',
};

beforeEach(() => {
  handleSpy.mockReset();
  appendMessage.mockReset();
  appendMessage.mockReturnValue(storedRow);
});

describe('conversations:appendMessage', () => {
  it('passes contentBlocks, cachedInputTokens, and turnStatus through the IPC schema', async () => {
    registerChatHandlers();
    const fn = getHandler('conversations:appendMessage');
    await fn(mainFrameEvent, {
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hi',
      contentBlocks: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'c1', name: 'fake_lookup', arguments: { q: 'x' } },
        { type: 'tool_result', toolUseId: 'c1', output: { ok: true }, isError: false },
      ],
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 12,
      costUsd: 0.001,
      turnStatus: 'streaming',
    });

    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentBlocks: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'c1', name: 'fake_lookup', arguments: { q: 'x' } },
          { type: 'tool_result', toolUseId: 'c1', output: { ok: true }, isError: false },
        ],
        cachedInputTokens: 12,
        turnStatus: 'streaming',
      }),
    );
  });

  it('rejects malformed contentBlocks instead of stripping them', async () => {
    registerChatHandlers();
    const fn = getHandler('conversations:appendMessage');
    await expect(
      fn(mainFrameEvent, {
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'hi',
        contentBlocks: [{ type: 'bogus' }],
      }),
    ).rejects.toThrow(/invalid request/);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it('rejects an unknown turnStatus', async () => {
    registerChatHandlers();
    const fn = getHandler('conversations:appendMessage');
    await expect(
      fn(mainFrameEvent, {
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'hi',
        turnStatus: 'half-done',
      }),
    ).rejects.toThrow(/invalid request/);
    expect(appendMessage).not.toHaveBeenCalled();
  });
});
