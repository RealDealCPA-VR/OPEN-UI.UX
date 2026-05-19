import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContentBlock } from '@opencodex/core';
import { Markdown } from '../components/Markdown';
import { ToolCallCard } from '../components/ToolCallCard';
import { groupContentBlocks } from '../components/tool-block-grouping';
import { useChat, type AssistantDraft } from '../state/chat-context';
import { useSelectedModel } from '../state/selected-model-context';
import type {
  Conversation,
  ConversationExportFormat,
  ConversationUsage,
  StoredMessage,
} from '../../shared/conversation';

export function ChatView(): JSX.Element {
  const { selected, selectedCapabilities, loading: modelLoading } = useSelectedModel();
  const chat = useChat();

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

  return (
    <aside className="chat-sidebar">
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
}

function ChatPane({
  providerId,
  modelId,
  modelName,
  supportsTools,
  chat,
}: ChatPaneProps): JSX.Element {
  const [input, setInput] = useState('');
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.draft]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || chat.streaming) return;
    setInput('');
    void chat.send({ providerId, modelId, userMessage: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
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

  return (
    <div className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-title">{modelName}</div>
        <UsageSummary usage={chat.usage} />
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
      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${modelName}…`}
          rows={3}
          disabled={chat.streaming}
        />
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
    <article className={`chat-bubble chat-bubble-${message.role}`}>
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
