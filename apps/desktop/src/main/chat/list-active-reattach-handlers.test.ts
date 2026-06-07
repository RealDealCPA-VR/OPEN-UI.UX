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

const listActiveStreams = vi.fn();
const getActivePartial = vi.fn();
vi.mock('./runner', () => ({
  startChatStream: vi.fn(),
  cancelChatStream: vi.fn(),
  listActiveStreams: () => listActiveStreams(),
  getActivePartial: (id: string) => getActivePartial(id),
}));

const listInterruptedTurns = vi.fn();
const consumeInterruptedTurn = vi.fn();
vi.mock('./turn-restore', () => ({
  listInterruptedTurns: () => listInterruptedTurns(),
  consumeInterruptedTurn: (id: string) => consumeInterruptedTurn(id),
}));

const listMessages = vi.fn();
vi.mock('../storage/conversations', () => ({
  appendMessage: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  getConversationUsage: vi.fn(),
  listConversations: vi.fn(),
  listMessages: (id: string) => listMessages(id),
  renameConversation: vi.fn(),
}));

const { registerChatHandlers } = await import('./handlers');

function getHandler(channel: string): IpcHandlerFn {
  const call = handleSpy.mock.calls.find(([c]) => c === channel);
  expect(call).toBeDefined();
  return call![1];
}

function partial(id: string, turnStatus: 'streaming' | 'final', content: string): StoredMessage {
  return {
    id,
    conversationId: 'conv-1',
    role: 'assistant',
    content,
    contentBlocks: null,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00Z',
    turnStatus,
  };
}

const mainFrameEvent = { senderFrame: null };

beforeEach(() => {
  handleSpy.mockReset();
  listActiveStreams.mockReset();
  getActivePartial.mockReset();
  listInterruptedTurns.mockReset();
  consumeInterruptedTurn.mockReset();
  listMessages.mockReset();
});

describe('chat:list-active', () => {
  it('returns both active live streams and interrupted turns', async () => {
    listActiveStreams.mockReturnValue([
      { conversationId: 'conv-1', streamId: 's1', assistantMessageId: 'a1' },
    ]);
    listInterruptedTurns.mockReturnValue([{ conversationId: 'conv-2', assistantMessageId: 'a2' }]);
    registerChatHandlers();
    const fn = getHandler('chat:list-active');
    const res = (await fn(mainFrameEvent, undefined)) as {
      active: Array<{ conversationId: string; streamId: string; live: boolean }>;
      interrupted: Array<{ conversationId: string; assistantMessageId: string }>;
    };
    expect(res.active).toEqual([
      { conversationId: 'conv-1', streamId: 's1', assistantMessageId: 'a1', live: true },
    ]);
    expect(res.interrupted).toEqual([{ conversationId: 'conv-2', assistantMessageId: 'a2' }]);
  });
});

describe('chat:reattach', () => {
  it('returns live=true with the streaming partial when a stream is in-flight', async () => {
    listActiveStreams.mockReturnValue([
      { conversationId: 'conv-1', streamId: 's1', assistantMessageId: 'a1' },
    ]);
    getActivePartial.mockReturnValue(partial('a1', 'streaming', 'half'));
    registerChatHandlers();
    const fn = getHandler('chat:reattach');
    const res = (await fn(mainFrameEvent, { conversationId: 'conv-1' })) as {
      live: boolean;
      streamId: string | null;
      assistantMessageId: string | null;
      partial: StoredMessage | null;
    };
    expect(res.live).toBe(true);
    expect(res.streamId).toBe('s1');
    expect(res.assistantMessageId).toBe('a1');
    expect(res.partial?.content).toBe('half');
    expect(res.partial?.turnStatus).toBe('streaming');
    expect(consumeInterruptedTurn).not.toHaveBeenCalled();
  });

  it('returns live=false with the final interrupted partial when no stream is live', async () => {
    listActiveStreams.mockReturnValue([]);
    consumeInterruptedTurn.mockReturnValue({
      conversationId: 'conv-1',
      assistantMessageId: 'a9',
    });
    listMessages.mockReturnValue([partial('a9', 'final', 'cut off here')]);
    registerChatHandlers();
    const fn = getHandler('chat:reattach');
    const res = (await fn(mainFrameEvent, { conversationId: 'conv-1' })) as {
      live: boolean;
      streamId: string | null;
      assistantMessageId: string | null;
      partial: StoredMessage | null;
    };
    expect(res.live).toBe(false);
    expect(res.streamId).toBeNull();
    expect(res.assistantMessageId).toBe('a9');
    expect(res.partial?.content).toBe('cut off here');
    expect(res.partial?.turnStatus).toBe('final');
  });

  it('returns an empty result when nothing is live or interrupted', async () => {
    listActiveStreams.mockReturnValue([]);
    consumeInterruptedTurn.mockReturnValue(null);
    registerChatHandlers();
    const fn = getHandler('chat:reattach');
    const res = (await fn(mainFrameEvent, { conversationId: 'conv-x' })) as {
      live: boolean;
      partial: StoredMessage | null;
    };
    expect(res.live).toBe(false);
    expect(res.partial).toBeNull();
  });
});
