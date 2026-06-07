// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QueuedMessage } from '../state/chat-context';

interface MockChat {
  conversations: unknown[];
  activeId: string | null;
  messages: unknown[];
  draft: null;
  streaming: boolean;
  streamWorkspaceRoot: string | null;
  error: string | null;
  loading: boolean;
  usage: null;
  queued: QueuedMessage[];
  enqueue: Mock;
  removeQueued: Mock;
  selectConversation: Mock;
  createConversation: Mock;
  deleteConversation: Mock;
  send: Mock;
  cancel: Mock;
  exportActive: Mock;
  reload: Mock;
}

let mockChat: MockChat;

function makeChat(overrides: Partial<MockChat> = {}): MockChat {
  return {
    conversations: [],
    activeId: 'c1',
    messages: [],
    draft: null,
    streaming: false,
    streamWorkspaceRoot: null,
    error: null,
    loading: false,
    usage: null,
    queued: [],
    enqueue: vi.fn(),
    removeQueued: vi.fn(),
    selectConversation: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    exportActive: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

vi.mock('../state/chat-context', () => ({
  useChat: () => mockChat,
}));

vi.mock('../state/selected-model-context', () => ({
  useSelectedModel: () => ({
    providers: [],
    configuredProviders: [],
    selected: { providerId: 'openai', modelId: 'gpt-4o' },
    selectedCapabilities: { displayName: 'GPT-4o', toolUse: true },
    loading: false,
    error: null,
    select: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('../components/VoiceInputButton', () => ({ VoiceInputButton: () => null }));
vi.mock('../components/ModelPicker', () => ({ ModelPicker: () => null }));
vi.mock('../components/CloudProviderTip', () => ({ CloudProviderTip: () => null }));
vi.mock('../components/ChatBudgetOverride', () => ({ ChatBudgetOverride: () => null }));
vi.mock('../components/ProviderSwitchButton', () => ({ ProviderSwitchButton: () => null }));
vi.mock('../components/ReplayConversationModal', () => ({ ReplayConversationModal: () => null }));

import { ChatView } from './ChatView';

function renderView(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ChatView />
    </MemoryRouter>,
  );
}

function installBridge(): void {
  const off = (): void => {};
  (window as unknown as { opencodex: unknown }).opencodex = {
    settings: {
      getCloudProviderTipShown: () => Promise.resolve(true),
      setCloudProviderTipShown: () => Promise.resolve(),
    },
    workspace: {
      get: () => Promise.resolve({ active: '/repo' }),
      onChanged: () => off,
    },
    mcp: {
      listPrompts: () => Promise.resolve([]),
      onChanged: () => off,
    },
    skills: {
      list: () => Promise.resolve({ skills: [] }),
      onChanged: () => off,
    },
    plugins: {
      listSlashCommands: () => Promise.resolve([]),
      runSlashCommand: () => Promise.resolve({ ok: true }),
      onChanged: () => off,
    },
    conversations: {
      onScrollToMessage: () => off,
    },
    attachments: {
      prepare: () => Promise.resolve({ prepared: [], errors: [] }),
    },
  };
}

beforeEach(() => {
  mockChat = makeChat();
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('ChatView composer while streaming', () => {
  it('keeps the textarea editable and the Send button present mid-stream', () => {
    mockChat = makeChat({ streaming: true });
    renderView();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('gives the composer a stable accessible name', () => {
    renderView();
    expect(screen.getByRole('textbox', { name: 'Message composer' })).toBeTruthy();
  });

  it('enqueues (does not send) when submitting during a stream', async () => {
    mockChat = makeChat({ streaming: true });
    renderView();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'follow up' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(mockChat.enqueue).toHaveBeenCalledTimes(1));
    expect(mockChat.send).not.toHaveBeenCalled();
    expect(mockChat.enqueue.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'openai',
      model: 'gpt-4o',
      text: 'follow up',
    });
    expect(textarea.value).toBe('');
  });

  it('sends normally when not streaming', async () => {
    mockChat = makeChat({ streaming: false });
    renderView();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(mockChat.send).toHaveBeenCalledTimes(1));
    expect(mockChat.enqueue).not.toHaveBeenCalled();
  });

  it('renders queue chips with position, preview, and a remove button', () => {
    mockChat = makeChat({
      streaming: true,
      queued: [
        { id: 'q1', providerId: 'openai', model: 'gpt-4o', text: 'first queued', attachments: [] },
        { id: 'q2', providerId: 'openai', model: 'gpt-4o', text: 'second queued', attachments: [] },
      ],
    });
    renderView();
    const chip0 = screen.getByTestId('chat-queue-chip-0');
    expect(within(chip0).getByText('#1')).toBeTruthy();
    expect(within(chip0).getByText('first queued')).toBeTruthy();
    const chip1 = screen.getByTestId('chat-queue-chip-1');
    expect(within(chip1).getByText('#2')).toBeTruthy();
    fireEvent.click(within(chip0).getByRole('button', { name: /remove queued message 1/i }));
    expect(mockChat.removeQueued).toHaveBeenCalledWith('q1');
  });
});
