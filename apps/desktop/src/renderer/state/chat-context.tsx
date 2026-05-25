import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ContentBlock } from '@opencodex/core';
import type { ChatAttachment } from '../../shared/attachments';
import type {
  Conversation,
  ConversationExportFormat,
  ConversationUsage,
  ExportConversationResult,
  StoredMessage,
} from '../../shared/conversation';

export interface AssistantDraft {
  messageId: string;
  text: string;
  blocks: ContentBlock[];
  done: boolean;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

interface ChatContextValue {
  conversations: Conversation[];
  activeId: string | null;
  messages: StoredMessage[];
  draft: AssistantDraft | null;
  streaming: boolean;
  streamWorkspaceRoot: string | null;
  error: string | null;
  loading: boolean;
  usage: ConversationUsage | null;
  selectConversation(id: string | null): void;
  createConversation(providerId: string | null, modelId: string | null): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  send(args: {
    providerId: string;
    modelId: string;
    userMessage: string;
    attachments?: ChatAttachment[];
  }): Promise<void>;
  cancel(): Promise<void>;
  exportActive(format: ConversationExportFormat): Promise<ExportConversationResult | null>;
  reload(): void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

interface ActiveStream {
  streamId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  workspaceRoot: string;
}

const EMPTY_MESSAGES: StoredMessage[] = [];

function appendDeltaBlock(blocks: ContentBlock[], delta: string): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text') {
    const next = blocks.slice(0, -1);
    next.push({ type: 'text', text: last.text + delta });
    return next;
  }
  return [...blocks, { type: 'text', text: delta }];
}

export function ChatProvider({ children }: { children: ReactNode }): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, StoredMessage[]>>({});
  const [usageByConv, setUsageByConv] = useState<Record<string, ConversationUsage>>({});
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamWorkspaceRoot, setStreamWorkspaceRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const activeStreamRef = useRef<ActiveStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.opencodex.conversations.list();
        if (cancelled) return;
        setConversations(list);
        setError(null);
        setActiveId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    (async () => {
      try {
        const [msgs, usage] = await Promise.all([
          window.opencodex.conversations.messages({ id: activeId }),
          window.opencodex.conversations.usage({ id: activeId }),
        ]);
        if (cancelled) return;
        setMessagesByConv((prev) => ({ ...prev, [activeId]: msgs }));
        setUsageByConv((prev) => ({ ...prev, [activeId]: usage }));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const finalizeStream = useCallback(async (errorMessage: string | null): Promise<void> => {
    const stream = activeStreamRef.current;
    activeStreamRef.current = null;
    setStreaming(false);
    setStreamWorkspaceRoot(null);
    if (!stream) {
      setDraft(null);
      if (errorMessage) setError(errorMessage);
      return;
    }
    try {
      const [msgs, list, usage] = await Promise.all([
        window.opencodex.conversations.messages({ id: stream.conversationId }),
        window.opencodex.conversations.list(),
        window.opencodex.conversations.usage({ id: stream.conversationId }),
      ]);
      setMessagesByConv((prev) => ({ ...prev, [stream.conversationId]: msgs }));
      setUsageByConv((prev) => ({ ...prev, [stream.conversationId]: usage }));
      setConversations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraft(null);
    }
    if (errorMessage) setError(errorMessage);
  }, []);

  useEffect(() => {
    return window.opencodex.chat.onEvent((payload) => {
      const current = activeStreamRef.current;
      if (!current || current.streamId !== payload.streamId) return;
      const event = payload.event;
      setDraft((prev) => {
        if (!prev) return prev;
        switch (event.type) {
          case 'text_delta':
            return {
              ...prev,
              text: prev.text + event.delta,
              blocks: appendDeltaBlock(prev.blocks, event.delta),
            };
          case 'tool_call':
            return {
              ...prev,
              blocks: [
                ...prev.blocks,
                { type: 'tool_use', id: event.id, name: event.name, arguments: event.arguments },
              ],
            };
          case 'tool_result':
            return {
              ...prev,
              blocks: [
                ...prev.blocks,
                {
                  type: 'tool_result',
                  toolUseId: event.id,
                  output: event.output,
                  isError: event.isError ?? false,
                },
              ],
            };
          case 'usage':
            return {
              ...prev,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              costUsd: event.costUsd ?? prev.costUsd,
            };
          case 'done':
            return { ...prev, done: true };
          case 'error':
            return { ...prev, done: true, error: event.message };
          default:
            return prev;
        }
      });
      if (event.type === 'done') void finalizeStream(null);
      if (event.type === 'error') void finalizeStream(event.message);
    });
  }, [finalizeStream]);

  const selectConversation = useCallback((id: string | null): void => {
    setActiveId(id);
    setDraft(null);
    setError(null);
  }, []);

  const createConversation = useCallback(
    async (providerId: string | null, modelId: string | null): Promise<Conversation> => {
      const created = await window.opencodex.conversations.create({ providerId, modelId });
      const list = await window.opencodex.conversations.list();
      setConversations(list);
      setActiveId(created.id);
      setMessagesByConv((prev) => ({ ...prev, [created.id]: [] }));
      return created;
    },
    [],
  );

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await window.opencodex.conversations.delete({ id });
      const list = await window.opencodex.conversations.list();
      setConversations(list);
      setMessagesByConv((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setUsageByConv((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeId === id) setActiveId(list[0]?.id ?? null);
    },
    [activeId],
  );

  const exportActive = useCallback(
    async (format: ConversationExportFormat): Promise<ExportConversationResult | null> => {
      if (!activeId) return null;
      try {
        return await window.opencodex.conversations.export({ id: activeId, format });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [activeId],
  );

  const send = useCallback(
    async (args: {
      providerId: string;
      modelId: string;
      userMessage: string;
      attachments?: ChatAttachment[];
    }): Promise<void> => {
      let conversationId = activeId;
      if (!conversationId) {
        const created = await window.opencodex.conversations.create({
          providerId: args.providerId,
          modelId: args.modelId,
        });
        conversationId = created.id;
        const list = await window.opencodex.conversations.list();
        setConversations(list);
        setActiveId(conversationId);
      }
      setStreaming(true);
      setError(null);
      try {
        const result = await window.opencodex.chat.start({
          conversationId,
          providerId: args.providerId,
          modelId: args.modelId,
          userMessage: args.userMessage,
          ...(args.attachments && args.attachments.length > 0
            ? { attachments: args.attachments }
            : {}),
        });
        activeStreamRef.current = {
          streamId: result.streamId,
          conversationId,
          userMessageId: result.userMessageId,
          assistantMessageId: result.assistantMessageId,
          workspaceRoot: result.workspaceRoot,
        };
        setStreamWorkspaceRoot(result.workspaceRoot);
        const msgs = await window.opencodex.conversations.messages({ id: conversationId });
        setMessagesByConv((prev) => ({ ...prev, [conversationId]: msgs }));
        setDraft({
          messageId: result.assistantMessageId,
          text: '',
          blocks: [],
          done: false,
          error: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        });
      } catch (err) {
        activeStreamRef.current = null;
        setStreaming(false);
        setStreamWorkspaceRoot(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeId],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const stream = activeStreamRef.current;
    if (!stream) return;
    await window.opencodex.chat.cancel({ streamId: stream.streamId });
  }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const messages = activeId ? (messagesByConv[activeId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const usage = activeId ? (usageByConv[activeId] ?? null) : null;
  const safeConversations = useMemo(() => conversations ?? [], [conversations]);

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations: safeConversations,
      activeId,
      messages,
      draft,
      streaming,
      streamWorkspaceRoot,
      error,
      loading: conversations === null,
      usage,
      selectConversation,
      createConversation,
      deleteConversation,
      send,
      cancel,
      exportActive,
      reload,
    }),
    [
      conversations,
      safeConversations,
      activeId,
      messages,
      draft,
      streaming,
      streamWorkspaceRoot,
      error,
      usage,
      selectConversation,
      createConversation,
      deleteConversation,
      send,
      cancel,
      exportActive,
      reload,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
