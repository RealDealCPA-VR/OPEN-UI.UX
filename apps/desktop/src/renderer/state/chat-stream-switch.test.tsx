// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import type { ChatEvent } from '@opencodex/core';
import type { Conversation } from '../../shared/conversation';
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
  onChanged: Mock;
}

let emitEvent: ((evt: ChatEvent) => void) | null = null;
let emitConversationsChanged: ((payload: { conversations: Conversation[] }) => void) | null = null;
let currentStreamId = 0;

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: 'New conversation',
    providerId: null,
    modelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    starred: false,
    projectId: null,
    ...overrides,
  };
}

function installBridge(): { chat: ChatBridge; conversations: ConversationsBridge } {
  const emptyUsage = {
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedInputTokens: 0,
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
    list: vi.fn(() => Promise.resolve([conv()])),
    messages: vi.fn(() => Promise.resolve([])),
    usage: vi.fn(() => Promise.resolve(emptyUsage)),
    create: vi.fn(() => Promise.resolve(conv())),
    delete: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn((listener: (payload: { conversations: Conversation[] }) => void) => {
      emitConversationsChanged = listener;
      return () => {
        emitConversationsChanged = null;
      };
    }),
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
  emitConversationsChanged = null;
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

describe('switching conversations during a stream', () => {
  it('hides the draft and streaming flag in other conversations and restores them on return', async () => {
    installBridge();
    const { result } = await renderChat();

    await act(async () => {
      await result.current.send({ providerId: 'p1', modelId: 'm1', userMessage: 'go' });
    });
    expect(result.current.streaming).toBe(true);

    await act(async () => {
      emitEvent?.({ type: 'text_delta', delta: 'hello' } as ChatEvent);
    });
    await waitFor(() => expect(result.current.draft?.text).toBe('hello'));

    // Switch away mid-stream: the stream UI must not leak into c2.
    act(() => result.current.selectConversation('c2'));
    await waitFor(() => expect(result.current.activeId).toBe('c2'));
    expect(result.current.draft).toBeNull();
    expect(result.current.streaming).toBe(false);

    // Deltas arriving while away still accumulate in the owner's draft.
    await act(async () => {
      emitEvent?.({ type: 'text_delta', delta: ' world' } as ChatEvent);
    });

    // Switching back restores the live draft with nothing lost.
    act(() => result.current.selectConversation('c1'));
    await waitFor(() => expect(result.current.draft?.text).toBe('hello world'));
    expect(result.current.streaming).toBe(true);

    await act(async () => {
      emitEvent?.({ type: 'done', stopReason: 'end_turn' } as ChatEvent);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.draft).toBeNull();
  });

  it('finalizeStream does not clobber a newer conversations:changed broadcast with its stale list', async () => {
    const { conversations } = installBridge();
    const { result } = await renderChat();

    await act(async () => {
      await result.current.send({ providerId: 'p1', modelId: 'm1', userMessage: 'go' });
    });

    // The finalize-time list() resolves only when we say so — after the
    // auto-title broadcast has already been applied.
    let resolveStaleList: ((list: Conversation[]) => void) | null = null;
    conversations.list.mockImplementation(
      () =>
        new Promise<Conversation[]>((resolve) => {
          resolveStaleList = resolve;
        }),
    );

    await act(async () => {
      emitEvent?.({ type: 'done', stopReason: 'end_turn' } as ChatEvent);
    });
    await waitFor(() => expect(resolveStaleList).not.toBeNull());

    act(() => {
      emitConversationsChanged?.({ conversations: [conv({ title: 'Auto title' })] });
    });
    await waitFor(() => expect(result.current.conversations[0]?.title).toBe('Auto title'));

    await act(async () => {
      resolveStaleList?.([conv({ title: 'New conversation' })]);
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.conversations[0]?.title).toBe('Auto title');
  });
});
