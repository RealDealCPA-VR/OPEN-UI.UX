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
  cachedInputTokens: number | null;
  costUsd: number | null;
}

export interface QueuedMessage {
  id: string;
  providerId: string;
  model: string;
  text: string;
  attachments: ChatAttachment[];
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
  queued: QueuedMessage[];
  interruptedConversationId: string | null;
  enqueue(message: Omit<QueuedMessage, 'id'>): void;
  removeQueued(id: string): void;
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
  // Crash-restore — set when this ref was rebuilt by chat.reattach() after a
  // renderer reload. finalizeStream must NOT auto-fire the queue for these:
  // only the window that performed chat:start owns the queue.
  reattached?: boolean;
}

const EMPTY_MESSAGES: StoredMessage[] = [];

function draftFromPartial(partial: StoredMessage): AssistantDraft {
  const blocks: ContentBlock[] =
    partial.contentBlocks && partial.contentBlocks.length > 0
      ? partial.contentBlocks
      : partial.content.length > 0
        ? [{ type: 'text', text: partial.content }]
        : [];
  return {
    messageId: partial.id,
    text: partial.content,
    blocks,
    done: false,
    error: null,
    inputTokens: partial.inputTokens,
    outputTokens: partial.outputTokens,
    cachedInputTokens: partial.cachedInputTokens,
    costUsd: partial.costUsd,
  };
}

function appendDeltaBlock(blocks: ContentBlock[], delta: string): ContentBlock[] {
  const lastIdx = blocks.length - 1;
  const last = blocks[lastIdx];
  if (last && last.type === 'text') {
    const next = blocks.slice();
    next[lastIdx] = { type: 'text', text: last.text + delta };
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
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [interruptedConversationId, setInterruptedConversationId] = useState<string | null>(null);
  const reattachedConvRef = useRef<Set<string>>(new Set());

  const activeStreamRef = useRef<ActiveStream | null>(null);
  const pendingDeltaRef = useRef<string>('');
  const deltaFlushRafRef = useRef<number | null>(null);
  const queueIdRef = useRef(0);
  // Holds the latest send() so finalizeStream can auto-fire the queue head
  // without re-subscribing the chat event listener on every send identity change.
  const sendRef = useRef<ChatContextValue['send'] | null>(null);
  const queuedRef = useRef<QueuedMessage[]>([]);

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

  // Crash-restore — once conversations are loaded, ask main which turns are
  // still live (renderer reload) or were interrupted by a hard crash. For the
  // active conversation: a LIVE entry rebuilds the draft + activeStreamRef
  // (reattached) and flips streaming on so the existing onEvent listener
  // resumes deltas; an INTERRUPTED entry arms a one-shot banner. Never auto-
  // fires the queue and never starts a second stream.
  useEffect(() => {
    if (conversations === null || !activeId) return;
    if (reattachedConvRef.current.has(activeId)) return;
    if (activeStreamRef.current?.conversationId === activeId) return;
    const reattach = window.opencodex.chat.reattach;
    if (!reattach) return;
    const targetId = activeId;
    reattachedConvRef.current.add(targetId);
    let cancelled = false;
    void reattach({ conversationId: targetId })
      .then((res) => {
        if (cancelled) return;
        if (res.live && res.streamId && res.assistantMessageId) {
          activeStreamRef.current = {
            streamId: res.streamId,
            conversationId: targetId,
            userMessageId: '',
            assistantMessageId: res.assistantMessageId,
            workspaceRoot: '',
            reattached: true,
          };
          setDraft(res.partial ? draftFromPartial(res.partial) : null);
          setStreaming(true);
          setError(null);
          return;
        }
        if (!res.live && res.assistantMessageId) {
          setInterruptedConversationId(targetId);
        }
      })
      .catch(() => {
        // Reattach is advisory; a failure just means no resume affordance.
      });
    return () => {
      cancelled = true;
    };
  }, [conversations, activeId]);

  // Lane 15 — pair suggestions engine wants to scope by active conversation.
  useEffect(() => {
    void window.opencodex.pair?.setActiveConversation({ conversationId: activeId }).catch(() => {});
  }, [activeId]);

  // A queued follow-up is bound to whatever conversation was active when it was
  // typed; drop the queue whenever the active conversation changes or is deleted.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueued([]);
  }, [activeId]);

  useEffect(() => {
    queuedRef.current = queued;
  }, [queued]);

  const finalizeStream = useCallback(async (errorMessage: string | null): Promise<void> => {
    const stream = activeStreamRef.current;
    const wasReattached = stream?.reattached === true;
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
    if (errorMessage) {
      setError(errorMessage);
      return;
    }
    // Reattached streams belong to the window that performed chat:start; the
    // reattaching window must not auto-fire its own queue when one resolves.
    if (wasReattached) return;
    // Clean done — fire the FIFO head of the queue as the next turn, carrying
    // its captured provider/model/attachments. Error/cancel preserve the queue.
    const head = queuedRef.current[0];
    if (head) {
      setQueued((prev) => prev.slice(1));
      void sendRef.current?.({
        providerId: head.providerId,
        modelId: head.model,
        userMessage: head.text,
        ...(head.attachments.length > 0 ? { attachments: head.attachments } : {}),
      });
    }
  }, []);

  const flushPendingDelta = useCallback((): void => {
    deltaFlushRafRef.current = null;
    const buffered = pendingDeltaRef.current;
    if (buffered.length === 0) return;
    pendingDeltaRef.current = '';
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        text: prev.text + buffered,
        blocks: appendDeltaBlock(prev.blocks, buffered),
      };
    });
  }, []);

  useEffect(() => {
    return window.opencodex.chat.onEvent((payload) => {
      const current = activeStreamRef.current;
      if (!current || current.streamId !== payload.streamId) return;
      const event = payload.event;
      if (event.type === 'text_delta') {
        pendingDeltaRef.current += event.delta;
        if (deltaFlushRafRef.current === null) {
          deltaFlushRafRef.current = requestAnimationFrame(flushPendingDelta);
        }
        return;
      }
      // Non-delta events must observe any pending text before they're applied,
      // otherwise tool_call/done would race past in-flight deltas.
      if (pendingDeltaRef.current.length > 0) {
        if (deltaFlushRafRef.current !== null) {
          cancelAnimationFrame(deltaFlushRafRef.current);
          deltaFlushRafRef.current = null;
        }
        flushPendingDelta();
      }
      setDraft((prev) => {
        if (!prev) return prev;
        switch (event.type) {
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
              cachedInputTokens: event.cachedInputTokens ?? prev.cachedInputTokens,
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
  }, [finalizeStream, flushPendingDelta]);

  const selectConversation = useCallback((id: string | null): void => {
    setActiveId(id);
    setDraft(null);
    setError(null);
    setInterruptedConversationId(null);
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
      setInterruptedConversationId((prev) => (prev === conversationId ? null : prev));
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
          cachedInputTokens: null,
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

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const enqueue = useCallback((message: Omit<QueuedMessage, 'id'>): void => {
    queueIdRef.current += 1;
    const id = `q${queueIdRef.current}`;
    setQueued((prev) => [...prev, { ...message, id }]);
  }, []);

  const removeQueued = useCallback((id: string): void => {
    setQueued((prev) => prev.filter((q) => q.id !== id));
  }, []);

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
      queued,
      interruptedConversationId,
      enqueue,
      removeQueued,
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
      queued,
      interruptedConversationId,
      enqueue,
      removeQueued,
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
