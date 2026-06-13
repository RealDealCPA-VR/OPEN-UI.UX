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
import type { Project } from '../../shared/projects';

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
  renameConversation(id: string, title: string): Promise<void>;
  toggleStarConversation(id: string): Promise<void>;
  // CD-21 — projects with custom instructions
  projects: Project[];
  createProject(name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  setProjectInstructions(id: string, instructions: string): Promise<void>;
  assignConversationToProject(id: string, projectId: string | null): Promise<void>;
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

// Single slot — one stream per window — but keyed by conversation so the live
// draft survives switching conversations and is only rendered in its owner.
interface DraftSlot {
  conversationId: string;
  draft: AssistantDraft;
}

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
  const [draftSlot, setDraftSlot] = useState<DraftSlot | null>(null);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [streamWorkspaceRoot, setStreamWorkspaceRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [interruptedConversationId, setInterruptedConversationId] = useState<string | null>(null);
  const reattachedConvRef = useRef<Set<string>>(new Set());

  const activeStreamRef = useRef<ActiveStream | null>(null);
  // Monotonic guard for the conversations list: every applied write bumps it,
  // and async list() fetches only apply when nothing newer landed meanwhile
  // (e.g. the auto-title conversations:changed broadcast racing finalizeStream).
  const conversationsVersionRef = useRef(0);
  const pendingDeltaRef = useRef<string>('');
  const deltaFlushRafRef = useRef<number | null>(null);
  const queueIdRef = useRef(0);
  // Holds the latest send() so finalizeStream can auto-fire the queue head
  // without re-subscribing the chat event listener on every send identity change.
  const sendRef = useRef<ChatContextValue['send'] | null>(null);
  const queuedRef = useRef<QueuedMessage[]>([]);

  const applyConversations = useCallback((list: Conversation[]): void => {
    conversationsVersionRef.current += 1;
    setConversations(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.opencodex.conversations.list();
        if (cancelled) return;
        applyConversations(list);
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
  }, [reloadKey, applyConversations]);

  // CD-21 — projects load + live updates. Guarded so test bridges without a
  // projects bridge are safe.
  useEffect(() => {
    const bridge = window.opencodex.projects;
    if (!bridge || typeof bridge.list !== 'function') return;
    let cancelled = false;
    void bridge
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        // projects are decorative for chat — a failed load just hides grouping
      });
    const off =
      typeof bridge.onChanged === 'function'
        ? bridge.onChanged((payload) => {
            if (!cancelled) setProjects(payload.projects);
          })
        : undefined;
    return () => {
      cancelled = true;
      off?.();
    };
  }, [reloadKey]);

  // Live-update the sidebar when the main process changes the list (auto-title,
  // rename, star, delete). Guarded so test bridges without onChanged are safe.
  useEffect(() => {
    const subscribe = window.opencodex.conversations.onChanged;
    if (typeof subscribe !== 'function') return;
    return subscribe((payload) => {
      applyConversations(payload.conversations);
    });
  }, [applyConversations]);

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
          setDraftSlot(
            res.partial ? { conversationId: targetId, draft: draftFromPartial(res.partial) } : null,
          );
          setStreamingConversationId(targetId);
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

  const finalizeStream = useCallback(
    async (errorMessage: string | null, opts?: { cancelled?: boolean }): Promise<void> => {
      const stream = activeStreamRef.current;
      const wasReattached = stream?.reattached === true;
      activeStreamRef.current = null;
      setStreamingConversationId(null);
      setStreamWorkspaceRoot(null);
      if (!stream) {
        setDraftSlot(null);
        if (errorMessage) setError(errorMessage);
        return;
      }
      const versionAtFetch = conversationsVersionRef.current;
      try {
        const [msgs, list, usage] = await Promise.all([
          window.opencodex.conversations.messages({ id: stream.conversationId }),
          window.opencodex.conversations.list(),
          window.opencodex.conversations.usage({ id: stream.conversationId }),
        ]);
        setMessagesByConv((prev) => ({ ...prev, [stream.conversationId]: msgs }));
        setUsageByConv((prev) => ({ ...prev, [stream.conversationId]: usage }));
        // A conversations:changed broadcast (e.g. auto-title) may have landed
        // while this fetch was in flight — a stale snapshot must not clobber it.
        if (conversationsVersionRef.current === versionAtFetch) {
          applyConversations(list);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDraftSlot(null);
      }
      if (errorMessage) {
        setError(errorMessage);
        return;
      }
      // Reattached streams belong to the window that performed chat:start; the
      // reattaching window must not auto-fire its own queue when one resolves.
      if (wasReattached) return;
      // Error/cancel preserve the queue — a user stop must not fire the next turn.
      if (opts?.cancelled) return;
      // Clean done — fire the FIFO head of the queue as the next turn, carrying
      // its captured provider/model/attachments.
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
    },
    [applyConversations],
  );

  const flushPendingDelta = useCallback((): void => {
    deltaFlushRafRef.current = null;
    const buffered = pendingDeltaRef.current;
    if (buffered.length === 0) return;
    pendingDeltaRef.current = '';
    setDraftSlot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        draft: {
          ...prev.draft,
          text: prev.draft.text + buffered,
          blocks: appendDeltaBlock(prev.draft.blocks, buffered),
        },
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
      setDraftSlot((prev) => {
        if (!prev) return prev;
        const draft = prev.draft;
        switch (event.type) {
          case 'tool_call':
            return {
              ...prev,
              draft: {
                ...draft,
                blocks: [
                  ...draft.blocks,
                  { type: 'tool_use', id: event.id, name: event.name, arguments: event.arguments },
                ],
              },
            };
          case 'tool_result':
            return {
              ...prev,
              draft: {
                ...draft,
                blocks: [
                  ...draft.blocks,
                  {
                    type: 'tool_result',
                    toolUseId: event.id,
                    output: event.output,
                    isError: event.isError ?? false,
                  },
                ],
              },
            };
          case 'usage':
            return {
              ...prev,
              draft: {
                ...draft,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                cachedInputTokens: event.cachedInputTokens ?? draft.cachedInputTokens,
                costUsd: event.costUsd ?? draft.costUsd,
              },
            };
          case 'done':
            return { ...prev, draft: { ...draft, done: true } };
          case 'error':
            return { ...prev, draft: { ...draft, done: true, error: event.message } };
          default:
            return prev;
        }
      });
      if (event.type === 'done') {
        void finalizeStream(null, { cancelled: event.stopReason === 'cancelled' });
      }
      if (event.type === 'error') void finalizeStream(event.message);
    });
  }, [finalizeStream, flushPendingDelta]);

  // The live draft is NOT cleared here — it stays in its slot (keyed by
  // conversation) so switching away and back during a stream loses nothing.
  const selectConversation = useCallback((id: string | null): void => {
    setActiveId(id);
    setError(null);
    setInterruptedConversationId(null);
  }, []);

  const createConversation = useCallback(
    async (providerId: string | null, modelId: string | null): Promise<Conversation> => {
      const created = await window.opencodex.conversations.create({ providerId, modelId });
      const list = await window.opencodex.conversations.list();
      applyConversations(list);
      setActiveId(created.id);
      setMessagesByConv((prev) => ({ ...prev, [created.id]: [] }));
      return created;
    },
    [applyConversations],
  );

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await window.opencodex.conversations.delete({ id });
      const list = await window.opencodex.conversations.list();
      applyConversations(list);
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
    [activeId, applyConversations],
  );

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      // Optimistic — the main process also broadcasts conversations:changed,
      // which reconciles the list shortly after.
      conversationsVersionRef.current += 1;
      setConversations((prev) =>
        prev ? prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)) : prev,
      );
      try {
        await window.opencodex.conversations.rename({ id, title: trimmed });
      } catch (err) {
        const list = await window.opencodex.conversations.list();
        applyConversations(list);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversations],
  );

  const toggleStarConversation = useCallback(
    async (id: string): Promise<void> => {
      let nextStarred = false;
      conversationsVersionRef.current += 1;
      setConversations((prev) => {
        if (!prev) return prev;
        return prev.map((c) => {
          if (c.id !== id) return c;
          nextStarred = !c.starred;
          return { ...c, starred: nextStarred };
        });
      });
      try {
        await window.opencodex.conversations.setStarred({ id, starred: nextStarred });
      } catch (err) {
        const list = await window.opencodex.conversations.list();
        applyConversations(list);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversations],
  );

  const createProject = useCallback(async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    try {
      await window.opencodex.projects.create({ name: trimmed });
      setProjects(await window.opencodex.projects.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteProject = useCallback(
    async (id: string): Promise<void> => {
      try {
        await window.opencodex.projects.delete({ id });
        const [projs, list] = await Promise.all([
          window.opencodex.projects.list(),
          window.opencodex.conversations.list(),
        ]);
        setProjects(projs);
        // Conversations survive but lose their assignment.
        applyConversations(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversations],
  );

  const setProjectInstructions = useCallback(
    async (id: string, instructions: string): Promise<void> => {
      try {
        const updated = await window.opencodex.projects.setInstructions({ id, instructions });
        setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const assignConversationToProject = useCallback(
    async (id: string, projectId: string | null): Promise<void> => {
      // Optimistic — main also broadcasts conversations:changed which reconciles.
      conversationsVersionRef.current += 1;
      setConversations((prev) =>
        prev ? prev.map((c) => (c.id === id ? { ...c, projectId } : c)) : prev,
      );
      try {
        await window.opencodex.conversations.assignProject({ id, projectId });
      } catch (err) {
        const list = await window.opencodex.conversations.list();
        applyConversations(list);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversations],
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
        applyConversations(list);
        setActiveId(conversationId);
      }
      setStreamingConversationId(conversationId);
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
        setDraftSlot({
          conversationId,
          draft: {
            messageId: result.assistantMessageId,
            text: '',
            blocks: [],
            done: false,
            error: null,
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            costUsd: null,
          },
        });
      } catch (err) {
        activeStreamRef.current = null;
        setStreamingConversationId(null);
        setStreamWorkspaceRoot(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeId, applyConversations],
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
  // Scope the live stream UI to the conversation that owns it — other
  // conversations must not show the draft, the streaming composer state, or
  // the Esc-cancel affordance for a stream they don't own.
  const draft =
    draftSlot !== null && draftSlot.conversationId === activeId ? draftSlot.draft : null;
  const streaming = streamingConversationId !== null && streamingConversationId === activeId;

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
      renameConversation,
      toggleStarConversation,
      projects,
      createProject,
      deleteProject,
      setProjectInstructions,
      assignConversationToProject,
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
      renameConversation,
      toggleStarConversation,
      projects,
      createProject,
      deleteProject,
      setProjectInstructions,
      assignConversationToProject,
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
