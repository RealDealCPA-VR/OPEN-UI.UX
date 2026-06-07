// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import type { ChatEvent } from '@opencodex/core';
import type { StoredMessage } from '../../shared/conversation';
import { ChatProvider, useChat } from './chat-context';

let emitEvent: ((evt: ChatEvent) => void) | null = null;
let reattachStreamId = 'live-1';

interface Bridges {
  chat: {
    start: Mock;
    cancel: Mock;
    onEvent: Mock;
    listActive: Mock;
    reattach: Mock;
  };
  conversations: {
    list: Mock;
    messages: Mock;
    usage: Mock;
    create: Mock;
    delete: Mock;
  };
}

const emptyUsage = {
  messageCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedInputTokens: 0,
  totalCostUsd: 0,
  byModel: [],
};

function livePartial(): StoredMessage {
  return {
    id: 'a1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'resumed so far',
    contentBlocks: null,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00Z',
    turnStatus: 'streaming',
  };
}

function installBridge(reattachResult: unknown): Bridges {
  const chat: Bridges['chat'] = {
    start: vi.fn(() =>
      Promise.resolve({
        streamId: 's-start',
        userMessageId: 'u1',
        assistantMessageId: 'a-start',
        workspaceRoot: '/repo',
      }),
    ),
    cancel: vi.fn(() => Promise.resolve()),
    onEvent: vi.fn((listener: (payload: { streamId: string; event: ChatEvent }) => void) => {
      emitEvent = (event: ChatEvent) => listener({ streamId: reattachStreamId, event });
      return () => {
        emitEvent = null;
      };
    }),
    listActive: vi.fn(() => Promise.resolve({ active: [], interrupted: [] })),
    reattach: vi.fn(() => Promise.resolve(reattachResult)),
  };
  const conversations: Bridges['conversations'] = {
    list: vi.fn(() => Promise.resolve([{ id: 'c1', title: 'Conv', createdAt: '', updatedAt: '' }])),
    messages: vi.fn(() => Promise.resolve([])),
    usage: vi.fn(() => Promise.resolve(emptyUsage)),
    create: vi.fn(() => Promise.resolve({ id: 'c1', title: 'Conv', createdAt: '', updatedAt: '' })),
    delete: vi.fn(() => Promise.resolve()),
  };
  (window as unknown as { opencodex: Bridges }).opencodex = { chat, conversations };
  return { chat, conversations };
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ChatProvider>{children}</ChatProvider>;
}

beforeEach(() => {
  emitEvent = null;
  reattachStreamId = 'live-1';
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

describe('chat reattach', () => {
  it('rebuilds the draft from the live partial and resumes deltas without auto-firing the queue', async () => {
    const { chat } = installBridge({
      live: true,
      streamId: 'live-1',
      assistantMessageId: 'a1',
      partial: livePartial(),
    });
    const { result } = await renderChat();

    await waitFor(() => expect(chat.reattach).toHaveBeenCalled());
    await waitFor(() => expect(result.current.streaming).toBe(true));

    // Draft reconstructed from the persisted partial.
    expect(result.current.draft?.messageId).toBe('a1');
    expect(result.current.draft?.text).toBe('resumed so far');

    // Queue a follow-up that must NOT fire when the reattached stream completes.
    act(() =>
      result.current.enqueue({ providerId: 'p', model: 'm', text: 'queued', attachments: [] }),
    );

    // A mocked chat:event delta on the reattached stream appends to the draft.
    await act(async () => {
      emitEvent?.({ type: 'text_delta', delta: ' and more' } as ChatEvent);
    });
    await waitFor(() => expect(result.current.draft?.text).toBe('resumed so far and more'));

    // The reattached stream resolves — queue head must NOT auto-fire (chat.start
    // is never called by the reattaching window).
    await act(async () => {
      emitEvent?.({ type: 'done' } as ChatEvent);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(chat.start).not.toHaveBeenCalled();
    expect(result.current.queued.map((q) => q.text)).toEqual(['queued']);
  });

  it('flags an interrupted conversation for a one-shot banner when no stream is live', async () => {
    installBridge({
      live: false,
      streamId: null,
      assistantMessageId: 'a1',
      partial: { ...livePartial(), turnStatus: 'final' },
    });
    const { result } = await renderChat();

    await waitFor(() => expect(result.current.interruptedConversationId).toBe('c1'));
    expect(result.current.streaming).toBe(false);

    // Selecting another conversation clears the one-shot flag.
    act(() => result.current.selectConversation('c1'));
    expect(result.current.interruptedConversationId).toBeNull();
  });
});
