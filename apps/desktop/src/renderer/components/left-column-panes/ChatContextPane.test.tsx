// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Conversation } from '../../../shared/conversation';
import type {
  ConversationSearchHit,
  ConversationSearchResponse,
} from '../../../shared/conversation-search';
import type { Project } from '../../../shared/projects';

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
    projectId: null,
  },
  {
    id: 'conv-2',
    title: 'Beta retrospective',
    providerId: null,
    modelId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    starred: false,
    projectId: null,
  },
];

// Mutable per-test fixtures consumed by the useChat mock below.
let mockConversations: Conversation[] = conversations;
let mockProjects: Project[] = [];
const createProjectMock = vi.fn(() => Promise.resolve());
const deleteProjectMock = vi.fn(() => Promise.resolve());
const setProjectInstructionsMock = vi.fn(() => Promise.resolve());
const assignConversationToProjectMock = vi.fn(() => Promise.resolve());

vi.mock('../../state/chat-context', () => ({
  useChat: () => ({
    conversations: mockConversations,
    activeId: 'conv-1',
    selectConversation: vi.fn(),
    createConversation: vi.fn(() => Promise.resolve(mockConversations[0])),
    deleteConversation: vi.fn(() => Promise.resolve()),
    renameConversation: vi.fn(() => Promise.resolve()),
    toggleStarConversation: vi.fn(() => Promise.resolve()),
    projects: mockProjects,
    createProject: createProjectMock,
    deleteProject: deleteProjectMock,
    setProjectInstructions: setProjectInstructionsMock,
    assignConversationToProject: assignConversationToProjectMock,
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
  mockConversations = conversations;
  mockProjects = [];
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('ChatContextPane Ctrl/Cmd+K shortcut', () => {
  it('focuses and selects the search input on Ctrl+K', () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Search conversations and messages');
    expect(document.activeElement).toBe(input);
  });

  it('does not steal focus while typing in another editable field', () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
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

describe('ChatContextPane projects (CD-21)', () => {
  const project: Project = {
    id: 'proj-1',
    name: 'Acme Site',
    instructions: 'Be terse.',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('groups assigned conversations under their project header', () => {
    mockProjects = [project];
    mockConversations = [conversations[0]!, { ...conversations[1]!, projectId: 'proj-1' }];
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);

    expect(screen.getByText('Acme Site')).toBeTruthy();
    const group = screen.getByText('Acme Site').closest('li');
    expect(group?.textContent).toContain('Beta retrospective');
    expect(group?.textContent).not.toContain('Alpha planning');
    expect(screen.getByText('Alpha planning')).toBeTruthy();
  });

  it('creates a project from the + affordance', () => {
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);

    fireEvent.click(screen.getByLabelText('New project'));
    const input = screen.getByLabelText('New project name');
    fireEvent.change(input, { target: { value: '  Acme Site  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(createProjectMock).toHaveBeenCalledWith('Acme Site');
    expect(screen.queryByLabelText('New project name')).toBeNull();
  });

  it('assigns a conversation to a project via the move-to-project select', () => {
    mockProjects = [project];
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);

    fireEvent.click(screen.getByLabelText('Move Alpha planning to a project'));
    const select = screen.getByLabelText('Move Alpha planning to project');
    fireEvent.change(select, { target: { value: 'proj-1' } });

    expect(assignConversationToProjectMock).toHaveBeenCalledWith('conv-1', 'proj-1');
  });

  it('edits and saves project instructions inline', () => {
    mockProjects = [project];
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);

    fireEvent.click(screen.getByLabelText('Edit instructions for Acme Site'));
    const textarea = screen.getByLabelText('Instructions for Acme Site');
    expect((textarea as HTMLTextAreaElement).value).toBe('Be terse.');
    fireEvent.change(textarea, { target: { value: 'Always reply in haiku.' } });
    fireEvent.click(screen.getByText('Save'));

    expect(setProjectInstructionsMock).toHaveBeenCalledWith('proj-1', 'Always reply in haiku.');
    expect(screen.queryByLabelText('Instructions for Acme Site')).toBeNull();
  });

  it('deletes a project from its header action', () => {
    mockProjects = [project];
    installBridge({ hits: [], truncated: false });
    render(<ChatContextPane />);

    fireEvent.click(screen.getByLabelText('Delete project Acme Site'));
    expect(deleteProjectMock).toHaveBeenCalledWith('proj-1');
  });
});
