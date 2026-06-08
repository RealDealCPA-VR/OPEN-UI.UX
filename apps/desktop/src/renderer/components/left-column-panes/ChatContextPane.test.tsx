// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Conversation } from '../../../shared/conversation';
import type {
  ConversationSearchHit,
  ConversationSearchResponse,
} from '../../../shared/conversation-search';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: (): typeof navigateMock => navigateMock,
}));

const conversations: Conversation[] = [
  {
    id: 'conv-1',
    title: 'Alpha planning',
    providerId: null,
    modelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    starred: false,
  },
  {
    id: 'conv-2',
    title: 'Beta retrospective',
    providerId: null,
    modelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    starred: false,
  },
];

vi.mock('../../state/chat-context', () => ({
  useChat: () => ({
    conversations,
    activeId: 'conv-1',
    selectConversation: vi.fn(),
    createConversation: vi.fn(() => Promise.resolve(conversations[0])),
    deleteConversation: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock('../../state/selected-model-context', () => ({
  useSelectedModel: () => ({ selected: null }),
}));

vi.mock('../MultiWorkspaceSelector', () => ({
  MultiWorkspaceSelector: () => null,
}));

vi.mock('../SuggestionsPane', () => ({
  SuggestionsPane: () => null,
}));

import ChatContextPane from './ChatContextPane';

interface OpencodexMock {
  conversations: { search: Mock };
  workspace: {
    get: Mock;
    browse: Mock;
    onChanged: Mock;
  };
}

function makeHit(overrides: Partial<ConversationSearchHit> = {}): ConversationSearchHit {
  return {
    conversationId: 'conv-2',
    conversationTitle: 'Beta retrospective',
    messageId: 'msg-9',
    role: 'assistant',
    createdAt: '2026-01-02T00:00:00.000Z',
    snippet: 'the gamma keyword appears here',
    score: 1,
    ...overrides,
  };
}

function installBridge(response: ConversationSearchResponse): OpencodexMock {
  const mock: OpencodexMock = {
    conversations: { search: vi.fn(() => Promise.resolve(response)) },
    workspace: {
      get: vi.fn(() => Promise.resolve({ active: null })),
      browse: vi.fn(() => Promise.resolve({ active: null })),
      onChanged: vi.fn(() => () => {}),
    },
  };
  (window as unknown as { opencodex: OpencodexMock }).opencodex = mock;
  return mock;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('ChatContextPane message search', () => {
  it('updates the search input aria-label to mention messages', () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    expect(screen.getByLabelText('Search conversations and messages')).toBeTruthy();
  });

  it('still filters conversation titles in place', () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'Beta' } });
    expect(screen.getByText('Beta retrospective')).toBeTruthy();
    expect(screen.queryByText('Alpha planning')).toBeNull();
  });

  it('does not call search and shows no Messages section under 2 chars', () => {
    const bridge = installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'a' } });
    vi.advanceTimersByTime(500);
    expect(bridge.conversations.search).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Message search results')).toBeNull();
  });

  it('debounces a single search call and renders hits', async () => {
    const bridge = installBridge({ hits: [makeHit()], truncated: false });
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'ga' } });
    fireEvent.change(input, { target: { value: 'gam' } });
    fireEvent.change(input, { target: { value: 'gamma' } });

    expect(bridge.conversations.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(bridge.conversations.search).toHaveBeenCalledTimes(1);
    expect(bridge.conversations.search).toHaveBeenCalledWith({ query: 'gamma', limit: 20 });
    expect(screen.getByText('the gamma keyword appears here')).toBeTruthy();
  });

  it('shows "No message matches" for an empty result', async () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'zzz' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(screen.getByText('No message matches')).toBeTruthy();
  });

  it('discards stale results when the query is cleared before resolve', async () => {
    installBridge({ hits: [makeHit()], truncated: false });
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'gamma' } });
    fireEvent.change(input, { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.queryByLabelText('Message search results')).toBeNull();
  });

  it('navigates and dispatches scroll-to-message when a hit is activated', async () => {
    installBridge({ hits: [makeHit()], truncated: false });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<ChatContextPane />);
    const input = screen.getByLabelText('Search conversations and messages');
    fireEvent.change(input, { target: { value: 'gamma' } });
    await vi.advanceTimersByTimeAsync(200);

    const hitButton = screen.getByRole('button', {
      name: /the gamma keyword appears here/,
    });
    fireEvent.click(hitButton);

    expect(navigateMock).toHaveBeenCalledWith('/chat?conversationId=conv-2&messageId=msg-9');
    const dispatched = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e.type === 'conversation:scroll-to-message');
    expect(dispatched).toBeTruthy();
    expect((dispatched as CustomEvent).detail).toEqual({
      conversationId: 'conv-2',
      messageId: 'msg-9',
    });
  });
});
