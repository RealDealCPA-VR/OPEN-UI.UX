// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import type { ChatEvent } from '@opencodex/core';
import { ChatProvider, useChat } from './chat-context';

interface ChatBridge {
  start: Mock;
  cancel: Mock;
  onEvent: Mock;
}

interface ConversationsBridge {
  list: Mock;
  messages: Mock;
  usage: Mock;
  create: Mock;
  delete: Mock;
}

let emitEvent: ((evt: ChatEvent) => void) | null = null;
let currentStreamId = 0;

function installBridge(): { chat: ChatBridge; conversations: ConversationsBridge } {
  const emptyUsage = {
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    byModel: [],
  };
  const chat: ChatBridge = {
    start: vi.fn(() => {
      currentStreamId += 1;
      const streamId = `s${currentStreamId}`;
      return Promise.resolve({
        streamId,
        userMessageId: `u${currentStreamId}`,
        assistantMessageId: `a${currentStreamId}`,
        workspaceRoot: '/repo',
      });
    }),
    cancel: vi.fn(() => Promise.resolve()),
    onEvent: vi.fn((listener: (payload: { streamId: string; event: ChatEvent }) => void) => {
      emitEvent = (event: ChatEvent) => listener({ streamId: `s${currentStreamId}`, event });
      return () => {
        emitEvent = null;
      };
    }),
  };
  const conversations: ConversationsBridge = {
    list: vi.fn(() => Promise.resolve([{ id: 'c1', title: 'Conv', createdAt: '', updatedAt: '' }])),
    messages: vi.fn(() => Promise.resolve([])),
    usage: vi.fn(() => Promise.resolve(emptyUsage)),
    create: vi.fn(() => Promise.resolve({ id: 'c1', title: 'Conv', createdAt: '', updatedAt: '' })),
    delete: vi.fn(() => Promise.resolve()),
  };
  (
    window as unknown as { opencodex: { chat: ChatBridge; conversations: ConversationsBridge } }
  ).opencodex = { chat, conversations };
  return { chat, conversations };
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ChatProvider>{children}</ChatProvider>;
}

beforeEach(() => {
  emitEvent = null;
  currentStreamId = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

async function renderChat(): Promise<
  ReturnType<typeof renderHook<ReturnType<typeof useChat>, unknown>>
> {
  const hook = renderHook(() => useChat(), { wrapper });
  await waitFor(() => expect(hook.result.current.activeId).toBe('c1'));
  return hook;
}

describe('chat queue', () => {
  it('enqueue appends FIFO with stable ids and exposes queued', async () => {
    installBridge();
    const { result } = await renderChat();
    act(() =>
      result.current.enqueue({ providerId: 'p', model: 'm', text: 'first', attachments: [] }),
    );
    act(() =>
      result.current.enqueue({ providerId: 'p', model: 'm', text: 'second', attachments: [] }),
    );
    expect(result.current.queued.map((q) => q.text)).toEqual(['first', 'second']);
    expect(new Set(result.current.queued.map((q) => q.id)).size).toBe(2);
  });

  it('removeQueued drops one by id', async () => {
    installBridge();
    const { result } = await renderChat();
    act(() => result.current.enqueue({ providerId: 'p', model: 'm', text: 'a', attachments: [] }));
    act(() => result.current.enqueue({ providerId: 'p', model: 'm', text: 'b', attachments: [] }));
    const firstId = result.current.queued[0]?.id ?? '';
    act(() => result.current.removeQueued(firstId));
    expect(result.current.queued.map((q) => q.text)).toEqual(['b']);
  });

  it('auto-sends the FIFO head on a clean done with captured provider/model/attachments', async () => {
    const { chat } = installBridge();
    const { result } = await renderChat();
    await act(async () => {
      await result.current.send({ providerId: 'p1', modelId: 'm1', userMessage: 'go' });
    });
    expect(chat.start).toHaveBeenCalledTimes(1);

    act(() =>
      result.current.enqueue({ providerId: 'p2', model: 'm2', text: 'next', attachments: [] }),
    );

    await act(async () => {
      emitEvent?.({ type: 'done' } as ChatEvent);
    });

    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(2));
    const secondCall = chat.start.mock.calls[1]?.[0] as {
      providerId: string;
      modelId: string;
      userMessage: string;
    };
    expect(secondCall.providerId).toBe('p2');
    expect(secondCall.modelId).toBe('m2');
    expect(secondCall.userMessage).toBe('next');
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
  });

  it("preserves the queue and does not auto-fire when done carries stopReason 'cancelled'", async () => {
    const { chat } = installBridge();
    const { result } = await renderChat();
    await act(async () => {
      await result.current.send({ providerId: 'p1', modelId: 'm1', userMessage: 'go' });
    });
    act(() =>
      result.current.enqueue({ providerId: 'p2', model: 'm2', text: 'next', attachments: [] }),
    );

    await act(async () => {
      emitEvent?.({ type: 'done', stopReason: 'cancelled' } as ChatEvent);
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(chat.start).toHaveBeenCalledTimes(1);
    expect(result.current.queued.map((q) => q.text)).toEqual(['next']);
  });

  it('preserves the queue and does not auto-fire on error', async () => {
    const { chat } = installBridge();
    const { result } = await renderChat();
    await act(async () => {
      await result.current.send({ providerId: 'p1', modelId: 'm1', userMessage: 'go' });
    });
    act(() =>
      result.current.enqueue({ providerId: 'p2', model: 'm2', text: 'next', attachments: [] }),
    );

    await act(async () => {
      emitEvent?.({ type: 'error', message: 'boom' } as ChatEvent);
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(chat.start).toHaveBeenCalledTimes(1);
    expect(result.current.queued.map((q) => q.text)).toEqual(['next']);
  });

  it('clears the queue when the active conversation changes', async () => {
    installBridge();
    const { result } = await renderChat();
    act(() => result.current.enqueue({ providerId: 'p', model: 'm', text: 'x', attachments: [] }));
    expect(result.current.queued).toHaveLength(1);
    act(() => result.current.selectConversation('c2'));
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
  });

  it('clears the queue when the active conversation is deleted', async () => {
    const { conversations } = installBridge();
    const { result } = await renderChat();
    // After deletion the list is empty, so activeId flips to null and the
    // active-conversation effect drops the queue.
    conversations.list.mockResolvedValue([]);
    act(() => result.current.enqueue({ providerId: 'p', model: 'm', text: 'x', attachments: [] }));
    await act(async () => {
      await result.current.deleteConversation('c1');
    });
    await waitFor(() => expect(result.current.queued).toHaveLength(0));
  });
});
