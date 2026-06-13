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
import type { StoredMessage } from '../../shared/conversation';

const appendMessageMock = vi.fn((_req: unknown) => Promise.resolve({}));

function storedMsg(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'hello',
    contentBlocks: null,
    providerId: 'openai',
    modelId: 'gpt-4o',
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    turnStatus: 'final',
    ...overrides,
  };
}

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
      appendMessage: appendMessageMock,
    },
    attachments: {
      prepare: () => Promise.resolve({ prepared: [], errors: [] }),
    },
  };
}

beforeEach(() => {
  mockChat = makeChat();
  installBridge();
  window.localStorage.clear();
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

  it('does not insert a slash on Ctrl+K (the sidebar search owns the shortcut)', () => {
    renderView();
    const textarea = screen.getByRole('textbox', {
      name: 'Message composer',
    }) as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
    expect(textarea.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
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

describe('ChatView plugin slash commands', () => {
  const runSlashCommandMock = vi.fn(
    (_req: unknown): Promise<{ ok: true } | { ok: false; error: string }> =>
      Promise.resolve({ ok: true }),
  );

  beforeEach(() => {
    runSlashCommandMock.mockClear();
    const bridge = (window as unknown as { opencodex: { plugins: Record<string, unknown> } })
      .opencodex;
    bridge.plugins = {
      listSlashCommands: () =>
        Promise.resolve([{ pluginId: 'p1', pluginName: 'Deploy Tools', name: 'deploy' }]),
      runSlashCommand: runSlashCommandMock,
      onChanged: () => () => {},
    };
  });

  async function typeIntoComposer(value: string): Promise<HTMLTextAreaElement> {
    const textarea = screen.getByRole('textbox', {
      name: 'Message composer',
    }) as HTMLTextAreaElement;
    // Open the slash menu first and wait for the plugin group, which proves the
    // listSlashCommands round-trip landed in state before submitting.
    fireEvent.change(textarea, { target: { value: '/' } });
    await screen.findByText('Plugin — Deploy Tools');
    fireEvent.change(textarea, { target: { value } });
    return textarea;
  }

  it('shows plugin commands in the slash menu and dispatches with args on submit', async () => {
    renderView();
    const textarea = await typeIntoComposer('/deploy prod --fast');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(runSlashCommandMock).toHaveBeenCalledTimes(1));
    expect(runSlashCommandMock).toHaveBeenCalledWith({
      pluginId: 'p1',
      name: 'deploy',
      args: 'prod --fast',
    });
    expect(mockChat.send).not.toHaveBeenCalled();
    await waitFor(() => expect(appendMessageMock).toHaveBeenCalledTimes(1));
    expect(appendMessageMock.mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'c1',
      role: 'system',
    });
    await waitFor(() => expect(mockChat.reload).toHaveBeenCalledTimes(1));
    expect(textarea.value).toBe('');
  });

  it('surfaces a handler failure as a system message instead of crashing', async () => {
    runSlashCommandMock.mockResolvedValueOnce({ ok: false, error: 'boom' });
    renderView();
    // Bare '/deploy' keeps the slash menu open, so the first Enter selects the
    // highlighted command (inserting '/deploy ') and the second one submits.
    const textarea = await typeIntoComposer('/deploy');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('/deploy '));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(appendMessageMock).toHaveBeenCalledTimes(1));
    expect(appendMessageMock.mock.calls[0]?.[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('failed: boom') as unknown,
    });
    expect(mockChat.send).not.toHaveBeenCalled();
  });

  it('sends unrecognized slash text to the model as a normal message', async () => {
    renderView();
    const textarea = await typeIntoComposer('/unknown thing');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(mockChat.send).toHaveBeenCalledTimes(1));
    expect(runSlashCommandMock).not.toHaveBeenCalled();
  });
});

describe('ChatView copy message', () => {
  it('copies assistant replies without inline <think> reasoning', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockChat = makeChat({
      messages: [storedMsg({ content: '<think>secret chain of thought</think>\n\nthe answer' })],
    });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('the answer'));
  });

  it('copies user messages verbatim', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockChat = makeChat({
      messages: [storedMsg({ role: 'user', content: 'literal <think>not reasoning</think>' })],
    });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('literal <think>not reasoning</think>'),
    );
  });
});

describe('ChatView regenerate', () => {
  it('persists a system instruction to disregard the rejected reply before re-sending', async () => {
    mockChat = makeChat({
      messages: [
        storedMsg({ id: 'u1', role: 'user', content: 'what is 2+2?' }),
        storedMsg({ id: 'a1', role: 'assistant', content: 'five' }),
      ],
    });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockChat.send).toHaveBeenCalledTimes(1));
    expect(appendMessageMock).toHaveBeenCalledTimes(1);
    expect(appendMessageMock.mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'c1',
      role: 'system',
    });
    expect(mockChat.send.mock.calls[0]?.[0]).toMatchObject({ userMessage: 'what is 2+2?' });
  });
});

describe('ChatView artifact panel auto-preview', () => {
  it('re-opens the panel for a new artifact after the previous one was dismissed', () => {
    mockChat = makeChat({
      messages: [storedMsg({ id: 'a1', content: '```html\n<b>one</b>\n```' })],
    });
    const view = renderView();
    expect(screen.getByLabelText('Artifact preview')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByLabelText('Artifact preview')).toBeNull();

    mockChat = makeChat({
      messages: [
        storedMsg({ id: 'a1', content: '```html\n<b>one</b>\n```' }),
        storedMsg({ id: 'a2', content: '```html\n<b>two</b>\n```' }),
      ],
    });
    view.rerender(
      <MemoryRouter>
        <ChatView />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Artifact preview')).toBeTruthy();
  });
});
