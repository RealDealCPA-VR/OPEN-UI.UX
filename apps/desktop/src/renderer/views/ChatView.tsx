import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ContentBlock } from '@opencodex/core';
import {
  extractFilePathsFromMessages,
  lastUserMessageText,
} from '../components/extract-file-paths';
import { Markdown } from '../components/Markdown';
import { SlashCommands } from '../components/SlashCommands';
import {
  applyInsert,
  filterPrompts,
  formatPromptInsert,
  getSlashTrigger,
  type SlashCommandTrigger,
} from '../components/slash-commands';
import { ToolCallCard } from '../components/ToolCallCard';
import { groupContentBlocks } from '../components/tool-block-grouping';
import { useChat, type AssistantDraft } from '../state/chat-context';
import { useCollapseState } from '../state/use-collapse-state';
import { useSelectedModel } from '../state/selected-model-context';
import { consumeTransfer, pushTransfer, useTransferPending } from '../state/transfer';
import type { ChatAttachment } from '../../shared/attachments';
import type {
  Conversation,
  ConversationExportFormat,
  ConversationUsage,
  StoredMessage,
} from '../../shared/conversation';
import type { McpPromptEntry } from '../../shared/mcp';

export function ChatView(): JSX.Element {
  const { selected, selectedCapabilities, loading: modelLoading } = useSelectedModel();
  const chat = useChat();
  const { activeId: chatActiveId, selectConversation, createConversation } = chat;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConversationId = searchParams.get('conversationId');
  const urlMessageId = searchParams.get('messageId');
  const transfer = useTransferPending();
  const [seededInput, setSeededInput] = useState<string | null>(null);

  useEffect(() => {
    if (!urlConversationId) return;
    if (chatActiveId === urlConversationId) return;
    selectConversation(urlConversationId);
  }, [urlConversationId, chatActiveId, selectConversation]);

  // Handle inbound transfers from the agent / codebase views.
  useEffect(() => {
    if (!transfer) return;
    if (transfer.kind === 'agent-to-chat') {
      const ctx = transfer;
      consumeTransfer();
      void (async () => {
        const created = await createConversation(
          selected?.providerId ?? null,
          selected?.modelId ?? null,
        );
        try {
          await window.opencodex.conversations.appendMessage({
            conversationId: created.id,
            role: 'system',
            content: `Continuing from subagent run.\n\n${ctx.summary}`,
          });
        } catch {
          // Not fatal — the conversation still exists; user can re-send.
        }
        selectConversation(created.id);
      })();
    } else if (transfer.kind === 'codebase-to-chat') {
      const ctx = transfer;
      consumeTransfer();
      void (async () => {
        const created = await createConversation(
          selected?.providerId ?? null,
          selected?.modelId ?? null,
        );
        selectConversation(created.id);
        setSeededInput(`Re: ${ctx.filePath}\n\n`);
      })();
    }
  }, [transfer, createConversation, selectConversation, selected]);

  return (
    <section className="chat-layout">
      <ConversationSidebar />
      <div className="chat-main">
        {modelLoading ? (
          <p className="chat-empty">Loading…</p>
        ) : !selected ? (
          <p className="chat-empty">
            Pick a model in the top bar, or{' '}
            <Link to="/settings">add a provider API key in Settings</Link>.
          </p>
        ) : !selectedCapabilities ? (
          <p className="chat-warn">
            The previously selected model (<code>{selected.providerId}</code> ·{' '}
            <code>{selected.modelId}</code>) isn&apos;t available. Pick another in the top bar.
          </p>
        ) : (
          <ChatPane
            providerId={selected.providerId}
            modelId={selected.modelId}
            modelName={selectedCapabilities.displayName}
            supportsTools={selectedCapabilities.toolUse}
            chat={chat}
            scrollToMessageId={urlMessageId}
            scrollToConversationId={urlConversationId}
            seededInput={seededInput}
            onConsumedSeededInput={() => setSeededInput(null)}
            onConsumeScrollTarget={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('messageId');
              next.delete('conversationId');
              setSearchParams(next, { replace: true });
            }}
          />
        )}
      </div>
    </section>
  );
}

function ConversationSidebar(): JSX.Element {
  const { conversations, activeId, selectConversation, createConversation, deleteConversation } =
    useChat();
  const { selected } = useSelectedModel();
  const [collapsed, toggleCollapsed] = useCollapseState('opencodex.chatSidebar.collapsed', false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key === '\\') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  if (collapsed) {
    return (
      <aside className="chat-sidebar collapsed" aria-label="Conversations">
        <button
          type="button"
          className="chat-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title="Expand conversations (Ctrl/⌘+\\)"
          aria-label="Expand conversations"
        >
          ›
        </button>
        <button
          type="button"
          className="chat-sidebar-new-icon"
          onClick={() =>
            void createConversation(selected?.providerId ?? null, selected?.modelId ?? null)
          }
          title="New chat"
          aria-label="New chat"
        >
          +
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-head">
        <span className="chat-sidebar-title">Conversations</span>
        <button
          type="button"
          className="chat-sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title="Collapse (Ctrl/⌘+\\)"
          aria-label="Collapse conversations"
        >
          ‹
        </button>
      </div>
      <WorkspaceChip />
      <button
        type="button"
        className="btn btn-primary chat-new"
        onClick={() => {
          void createConversation(selected?.providerId ?? null, selected?.modelId ?? null);
        }}
      >
        + New chat
      </button>
      <ul className="chat-conversation-list">
        {conversations.length === 0 ? (
          <li className="chat-conversation-empty">No conversations yet</li>
        ) : (
          conversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onSelect={() => selectConversation(c.id)}
              onDelete={() => {
                if (window.confirm(`Delete "${c.title}"?`)) {
                  void deleteConversation(c.id);
                }
              }}
            />
          ))
        )}
      </ul>
    </aside>
  );
}

function WorkspaceChip(): JSX.Element {
  const [activePath, setActivePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setActivePath(s.active);
      })
      .catch(() => {
        /* ignore */
      });
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setActivePath(payload.state.active);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await window.opencodex.workspace.browse();
      setActivePath(next.active);
    } catch {
      /* dialog cancelled or failed */
    } finally {
      setBusy(false);
    }
  };

  const label = activePath ? folderName(activePath) : 'Pick workspace…';
  const title = activePath ?? 'No workspace selected — agent will use a default folder';

  return (
    <button
      type="button"
      className={activePath ? 'workspace-chip' : 'workspace-chip workspace-chip-empty'}
      onClick={() => void handleClick()}
      title={title}
      disabled={busy}
    >
      <span className="workspace-chip-icon" aria-hidden="true">
        📁
      </span>
      <span className="workspace-chip-label">{label}</span>
      <span className="workspace-chip-caret" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

function folderName(path: string): string {
  const cleaned = path.replace(/[\\/]$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <li className={`chat-conversation-row${active ? ' active' : ''}`}>
      <button type="button" className="chat-conversation-btn" onClick={onSelect}>
        <span className="chat-conversation-title">{conversation.title}</span>
        <span className="chat-conversation-meta">
          {new Date(conversation.updatedAt).toLocaleDateString()}
        </span>
      </button>
      <button
        type="button"
        className="chat-conversation-del"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete ${conversation.title}`}
      >
        ×
      </button>
    </li>
  );
}

interface ChatPaneProps {
  providerId: string;
  modelId: string;
  modelName: string;
  supportsTools: boolean;
  chat: ReturnType<typeof useChat>;
  scrollToMessageId: string | null;
  scrollToConversationId: string | null;
  seededInput?: string | null;
  onConsumedSeededInput?: () => void;
  onConsumeScrollTarget: () => void;
}

function ChatPane({
  providerId,
  modelId,
  modelName,
  supportsTools,
  chat,
  scrollToMessageId,
  scrollToConversationId,
  seededInput,
  onConsumedSeededInput,
  onConsumeScrollTarget,
}: ChatPaneProps): JSX.Element {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [mcpPrompts, setMcpPrompts] = useState<McpPromptEntry[]>([]);
  const [slashTrigger, setSlashTrigger] = useState<SlashCommandTrigger | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const consumedScrollRef = useRef<Set<string>>(new Set());
  const skipBottomScrollRef = useRef(false);
  const { messages: chatMessages, draft: chatDraft, activeId: chatActiveId } = chat;

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setActiveWorkspace(s.active);
      })
      .catch(() => {
        // Banner is an advisory affordance; ignore load errors.
      });
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setActiveWorkspace(payload.state.active);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.opencodex.mcp
        .listPrompts()
        .then((rows) => {
          if (!cancelled) setMcpPrompts(rows);
        })
        .catch(() => {
          // Slash menu degrades gracefully when prompts can't load.
        });
    };
    refresh();
    const off = window.opencodex.mcp.onChanged(() => refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useLayoutEffect(() => {
    if (!scrollToMessageId) return;
    if (consumedScrollRef.current.has(scrollToMessageId)) return;
    if (scrollToConversationId && chatActiveId !== scrollToConversationId) return;
    if (!chatMessages.some((m) => m.id === scrollToMessageId)) return;
    const el = document.getElementById(`chat-message-${scrollToMessageId}`);
    if (!el) return;
    consumedScrollRef.current.add(scrollToMessageId);
    skipBottomScrollRef.current = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('chat-bubble-highlight');
    const t = window.setTimeout(() => {
      el.classList.remove('chat-bubble-highlight');
    }, 2000);
    onConsumeScrollTarget();
    return () => window.clearTimeout(t);
  }, [
    scrollToMessageId,
    scrollToConversationId,
    chatActiveId,
    chatMessages,
    onConsumeScrollTarget,
  ]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useLayoutEffect(() => {
    if (skipBottomScrollRef.current) {
      skipBottomScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatDraft]);

  const filteredSlashPrompts = useMemo(
    () => (slashTrigger ? filterPrompts(mcpPrompts, slashTrigger.query) : []),
    [slashTrigger, mcpPrompts],
  );
  const slashOpen = slashTrigger !== null;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (slashOpen) return;
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || chat.streaming) return;
    if (preparingAttachments) return;
    setInput('');
    const sent = attachments;
    setAttachments([]);
    setAttachmentError(null);
    void chat.send({
      providerId,
      modelId,
      userMessage: trimmed,
      ...(sent.length > 0 ? { attachments: sent } : {}),
    });
  };

  const ingestDroppedPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    setPreparingAttachments(true);
    setAttachmentError(null);
    try {
      const result = await window.opencodex.attachments.prepare({ paths });
      if (result.prepared.length > 0) {
        setAttachments((prev) => [...prev, ...result.prepared]);
      }
      if (result.errors.length > 0) {
        setAttachmentError(
          result.errors.map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.message}`).join('; '),
        );
      }
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparingAttachments(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    const paths: string[] = [];
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path;
      if (typeof filePath === 'string' && filePath.length > 0) paths.push(filePath);
    }
    if (paths.length > 0) void ingestDroppedPaths(paths);
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>): void => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!dragOver) setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>): void => {
    if (e.currentTarget === e.target) setDragOver(false);
  };

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const closeSlash = (): void => {
    setSlashTrigger(null);
    setSlashActiveIndex(0);
  };

  const insertPrompt = (entry: McpPromptEntry): void => {
    if (!slashTrigger) return;
    const el = inputRef.current;
    const caret = el ? (el.selectionEnd ?? input.length) : input.length;
    const insert = formatPromptInsert(entry);
    const next = applyInsert(input, slashTrigger, caret, insert);
    setInput(next.value);
    closeSlash();
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    }
  };

  const updateSlashFromCaret = (value: string, caret: number): void => {
    const trigger = getSlashTrigger(value, caret);
    setSlashTrigger(trigger);
    if (!trigger) setSlashActiveIndex(0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    setInput(next);
    updateSlashFromCaret(next, e.target.selectionEnd ?? next.length);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    updateSlashFromCaret(el.value, el.selectionEnd ?? el.value.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlash();
        return;
      }
      if (filteredSlashPrompts.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashActiveIndex((i) => (i + 1) % filteredSlashPrompts.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashActiveIndex(
            (i) => (i - 1 + filteredSlashPrompts.length) % filteredSlashPrompts.length,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const idx = Math.min(slashActiveIndex, filteredSlashPrompts.length - 1);
          const entry = filteredSlashPrompts[idx];
          if (entry) insertPrompt(entry);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleRerun = (prompt: string): void => {
    setInput(prompt);
    const el = inputRef.current;
    if (el) {
      el.focus();
      const len = prompt.length;
      el.setSelectionRange(len, len);
    }
  };

  const visibleMessages = chat.draft
    ? chat.messages.filter((m) => m.id !== chat.draft?.messageId)
    : chat.messages;

  const streamWorkspaceRoot = chat.streamWorkspaceRoot;
  const showWorkspaceMismatch =
    chat.streaming &&
    streamWorkspaceRoot !== null &&
    activeWorkspace !== null &&
    activeWorkspace !== streamWorkspaceRoot;

  const [lastAppliedSeed, setLastAppliedSeed] = useState<string | null>(null);
  if (seededInput && seededInput !== lastAppliedSeed) {
    setLastAppliedSeed(seededInput);
    setInput(seededInput);
  }

  useEffect(() => {
    if (!seededInput || seededInput !== lastAppliedSeed) return;
    onConsumedSeededInput?.();
    const seedLen = seededInput.length;
    const handle = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(seedLen, seedLen);
    });
    return () => cancelAnimationFrame(handle);
  }, [seededInput, lastAppliedSeed, onConsumedSeededInput]);

  const handleSendToAgent = useCallback((): void => {
    if (!chat.activeId) return;
    const lastUser = lastUserMessageText(chat.messages);
    const taskSeed =
      lastUser.trim().length > 0
        ? lastUser
        : (chat.messages[chat.messages.length - 1]?.content ?? '');
    pushTransfer({
      kind: 'chat-to-agent',
      conversationId: chat.activeId,
      lastUserMessage: taskSeed,
      workspaceRoot: activeWorkspace ?? '',
    });
    navigate('/agent');
  }, [chat.activeId, chat.messages, activeWorkspace, navigate]);

  const handleSendToCodebase = useCallback((): void => {
    const filePaths = extractFilePathsFromMessages(chat.messages, { assistantOnly: true });
    pushTransfer({
      kind: 'chat-to-codebase',
      filePaths,
      workspaceRoot: activeWorkspace ?? '',
    });
    navigate('/codebase');
  }, [chat.messages, activeWorkspace, navigate]);

  return (
    <div className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-title">{modelName}</div>
        <UsageSummary usage={chat.usage} />
        <div className="chat-header-transfer">
          <button
            type="button"
            className="btn"
            disabled={!chat.activeId || chat.streaming}
            onClick={handleSendToAgent}
            title="Hand the conversation to the Agent view as a new autonomous run"
          >
            Send to Agent
          </button>
          <button
            type="button"
            className="btn"
            disabled={!chat.activeId}
            onClick={handleSendToCodebase}
            title="Open the Codebase view with file paths mentioned in this chat"
          >
            Send to Codebase
          </button>
        </div>
        <ExportMenu
          disabled={!chat.activeId || chat.streaming}
          onExport={(fmt) => {
            void chat.exportActive(fmt);
          }}
        />
        {chat.error ? <div className="chat-error">{chat.error}</div> : null}
      </header>
      <div className="chat-scroll" ref={scrollRef}>
        {visibleMessages.length === 0 && !chat.draft ? (
          <div className="chat-empty">Start a conversation by sending a message below.</div>
        ) : (
          <div className="chat-messages">
            {visibleMessages.map((m) => (
              <MessageBubble key={m.id} message={m} onRerun={handleRerun} />
            ))}
            {chat.draft ? <DraftBubble draft={chat.draft} onRerun={handleRerun} /> : null}
          </div>
        )}
      </div>
      {showWorkspaceMismatch ? (
        <div className="chat-workspace-banner" role="status">
          <span className="chat-workspace-banner-label">Workspace changed mid-chat.</span>{' '}
          <span className="chat-workspace-banner-body">
            This response is still running against{' '}
            <code className="chat-workspace-banner-path">{streamWorkspaceRoot}</code>. The next
            message will use <code className="chat-workspace-banner-path">{activeWorkspace}</code>.
          </span>
        </div>
      ) : null}
      <form
        className={dragOver ? 'chat-composer drag-over' : 'chat-composer'}
        onSubmit={handleSubmit}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachments.length > 0 || preparingAttachments || attachmentError ? (
          <div className="chat-attachments">
            {attachments.map((att, i) => (
              <AttachmentChip
                key={`${att.path}-${i}`}
                attachment={att}
                onRemove={() => removeAttachment(i)}
              />
            ))}
            {preparingAttachments ? (
              <span className="chat-attachment-loading">Preparing files…</span>
            ) : null}
            {attachmentError ? (
              <span className="chat-attachment-error">{attachmentError}</span>
            ) : null}
          </div>
        ) : null}
        <div className="chat-input-wrap">
          {slashTrigger !== null ? (
            <SlashCommands
              query={slashTrigger.query}
              prompts={mcpPrompts}
              activeIndex={Math.min(slashActiveIndex, Math.max(0, filteredSlashPrompts.length - 1))}
              onSelect={insertPrompt}
              onActiveIndexChange={setSlashActiveIndex}
              onClose={closeSlash}
            />
          ) : null}
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onBlur={() => {
              setTimeout(() => closeSlash(), 0);
            }}
            placeholder={`Message ${modelName}…`}
            rows={5}
            disabled={chat.streaming}
          />
        </div>
        <div className="chat-composer-actions">
          {supportsTools ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={toolsEnabled}
                onChange={(e) => setToolsEnabled(e.target.checked)}
              />
              <span>Tools</span>
            </label>
          ) : null}
          {chat.streaming ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void chat.cancel();
              }}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={input.trim().length === 0}>
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function UsageSummary({ usage }: { usage: ConversationUsage | null }): JSX.Element | null {
  if (!usage || usage.messageCount === 0) return null;
  const tokens = `${usage.totalInputTokens.toLocaleString()} in · ${usage.totalOutputTokens.toLocaleString()} out`;
  const cost = usage.totalCostUsd > 0 ? ` · $${usage.totalCostUsd.toFixed(4)}` : '';
  const title =
    usage.byModel
      .map(
        (r) =>
          `${r.providerId ?? 'unknown'} / ${r.modelId ?? 'unknown'}: ${r.inputTokens} in · ${r.outputTokens} out · $${r.costUsd.toFixed(4)} (${r.messageCount} msg${r.messageCount === 1 ? '' : 's'})`,
      )
      .join('\n') || undefined;
  return (
    <div className="chat-usage" title={title}>
      {tokens}
      {cost}
    </div>
  );
}

function ExportMenu({
  disabled,
  onExport,
}: {
  disabled: boolean;
  onExport: (format: ConversationExportFormat) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="chat-export" ref={popRef}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export ▾
      </button>
      {open ? (
        <div className="chat-export-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="chat-export-item"
            onClick={() => {
              setOpen(false);
              onExport('markdown');
            }}
          >
            Markdown (.md)
          </button>
          <button
            type="button"
            role="menuitem"
            className="chat-export-item"
            onClick={() => {
              setOpen(false);
              onExport('json');
            }}
          >
            JSON (.json)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  onRerun,
}: {
  message: StoredMessage;
  onRerun: (prompt: string) => void;
}): JSX.Element {
  const hasBlocks = message.contentBlocks !== null && message.contentBlocks.length > 0;
  return (
    <article
      id={`chat-message-${message.id}`}
      className={`chat-bubble chat-bubble-${message.role}`}
    >
      <header className="chat-bubble-head">{roleLabel(message.role)}</header>
      {hasBlocks ? (
        <BlockSequence blocks={message.contentBlocks ?? []} onRerun={onRerun} />
      ) : (
        <Markdown text={message.content} />
      )}
      {message.role === 'assistant' &&
      (message.inputTokens !== null || message.costUsd !== null) ? (
        <footer className="chat-bubble-foot">
          {message.inputTokens !== null
            ? `${message.inputTokens} in · ${message.outputTokens ?? 0} out`
            : ''}
          {message.costUsd !== null ? ` · $${message.costUsd.toFixed(4)}` : ''}
        </footer>
      ) : null}
    </article>
  );
}

function DraftBubble({
  draft,
  onRerun,
}: {
  draft: AssistantDraft;
  onRerun: (prompt: string) => void;
}): JSX.Element {
  const hasBlocks = draft.blocks.length > 0;
  return (
    <article className="chat-bubble chat-bubble-assistant chat-bubble-draft">
      <header className="chat-bubble-head">Assistant{!draft.done ? <CaretBlink /> : null}</header>
      {hasBlocks ? (
        <BlockSequence blocks={draft.blocks} onRerun={onRerun} />
      ) : (
        <Markdown text={draft.done ? '' : '…'} />
      )}
      {draft.error ? <p className="chat-warn">{draft.error}</p> : null}
      {draft.inputTokens !== null ? (
        <footer className="chat-bubble-foot">
          {draft.inputTokens} in · {draft.outputTokens ?? 0} out
          {draft.costUsd !== null ? ` · $${draft.costUsd.toFixed(4)}` : ''}
        </footer>
      ) : null}
    </article>
  );
}

function BlockSequence({
  blocks,
  onRerun,
}: {
  blocks: ContentBlock[];
  onRerun: (prompt: string) => void;
}): JSX.Element {
  const items = groupContentBlocks(blocks);
  return (
    <div className="chat-bubble-body">
      {items.map((item, idx) => {
        if (item.kind === 'text') {
          return <Markdown key={idx} text={item.text} />;
        }
        if (item.kind === 'tool') {
          return (
            <ToolCallCard
              key={item.use.id || idx}
              use={item.use}
              result={item.result}
              onRerun={onRerun}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function CaretBlink(): JSX.Element {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setOn((v) => !v), 500);
    return () => window.clearInterval(id);
  }, []);
  return <span className="chat-caret">{on ? '▍' : ' '}</span>;
}

function roleLabel(role: StoredMessage['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
  }
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}): JSX.Element {
  const icon = attachment.kind === 'image' ? '🖼' : attachment.kind === 'text' ? '📄' : '📎';
  const label =
    attachment.kind === 'text' && attachment.truncated
      ? `${attachment.name} (truncated)`
      : attachment.name;
  const size = formatAttachmentSize(attachment.sizeBytes);
  return (
    <span className={`chat-attachment chat-attachment-${attachment.kind}`}>
      <span className="chat-attachment-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="chat-attachment-name" title={attachment.path}>
        {label}
      </span>
      <span className="chat-attachment-size">{size}</span>
      <button
        type="button"
        className="chat-attachment-remove"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
      >
        ×
      </button>
    </span>
  );
}

function formatAttachmentSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
