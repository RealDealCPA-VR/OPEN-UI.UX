import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from '../../../shared/conversation';
import type { ConversationSearchHit } from '../../../shared/conversation-search';
import { useChat } from '../../state/chat-context';
import { useSelectedModel } from '../../state/selected-model-context';
import { MultiWorkspaceSelector } from '../MultiWorkspaceSelector';
import { recencyOf, relativeTime } from '../relative-time';
import { SuggestionsPane } from '../SuggestionsPane';

const MESSAGE_SEARCH_DEBOUNCE_MS = 200;
const MESSAGE_SEARCH_MIN_CHARS = 2;
const MESSAGE_SEARCH_LIMIT = 20;

export default function ChatContextPane(): JSX.Element {
  const {
    conversations,
    activeId,
    selectConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    toggleStarConversation,
  } = useChat();
  const { selected } = useSelectedModel();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Lane 15 — switch between Conversations list and Pair Suggestions
  const [tab, setTab] = useState<'conversations' | 'suggestions'>('conversations');

  // Cmd/Ctrl+K focuses the conversation/message search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTab('conversations');
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const trimmedQuery = query.trim();
  const messageSearchActive = trimmedQuery.length >= MESSAGE_SEARCH_MIN_CHARS;
  const [messageHits, setMessageHits] = useState<{
    query: string;
    hits: ConversationSearchHit[];
  } | null>(null);

  useEffect(() => {
    if (!messageSearchActive) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void window.opencodex.conversations
        .search({ query: trimmedQuery, limit: MESSAGE_SEARCH_LIMIT })
        .then((res) => {
          if (!cancelled) setMessageHits({ query: trimmedQuery, hits: res.hits });
        })
        .catch(() => {
          if (!cancelled) setMessageHits({ query: trimmedQuery, hits: [] });
        });
    }, MESSAGE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [trimmedQuery, messageSearchActive]);

  const currentHits =
    messageSearchActive && messageHits?.query === trimmedQuery ? messageHits.hits : null;

  const openMessageHit = (hit: ConversationSearchHit): void => {
    navigate(
      `/chat?conversationId=${encodeURIComponent(hit.conversationId)}&messageId=${encodeURIComponent(
        hit.messageId,
      )}`,
    );
    window.dispatchEvent(
      new CustomEvent('conversation:scroll-to-message', {
        detail: { conversationId: hit.conversationId, messageId: hit.messageId },
      }),
    );
  };

  const filtered =
    trimmedQuery.length === 0
      ? conversations
      : conversations.filter((c) => c.title.toLowerCase().includes(trimmedQuery.toLowerCase()));

  if (tab === 'suggestions') {
    return (
      <div className="lcc-pane lcc-pane-chat">
        <div className="lcc-pane-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="lcc-pane-tab"
            onClick={() => setTab('conversations')}
          >
            Conversations
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={true}
            className="lcc-pane-tab active"
            onClick={() => setTab('suggestions')}
          >
            Suggestions
          </button>
        </div>
        <SuggestionsPane conversationId={activeId} />
      </div>
    );
  }

  return (
    <div className="lcc-pane lcc-pane-chat">
      <div className="lcc-pane-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={true}
          className="lcc-pane-tab active"
          onClick={() => setTab('conversations')}
        >
          Conversations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="lcc-pane-tab"
          onClick={() => setTab('suggestions')}
        >
          Suggestions
        </button>
      </div>
      <div className="lcc-workspace-header">
        <WorkspaceChip />
        <MultiWorkspaceSelector conversationId={activeId} />
      </div>
      <button
        type="button"
        className="lcc-new-chat-btn"
        onClick={() => {
          void createConversation(selected?.providerId ?? null, selected?.modelId ?? null);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 2.5v9M2.5 7h9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        New Chat
      </button>
      <div className="lcc-pane-search-row">
        <span className="lcc-pane-search-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <input
          ref={searchRef}
          type="search"
          className="lcc-pane-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search  (⌘K)"
          aria-label="Search conversations and messages"
        />
      </div>
      <ul className="chat-conversation-list">
        {filtered.length === 0 ? (
          <li className="chat-conversation-empty">
            {conversations.length === 0
              ? 'No conversations yet. Start one with “+ New chat”.'
              : 'No matches'}
          </li>
        ) : (
          filtered.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onSelect={() => selectConversation(c.id)}
              onDelete={() => {
                void deleteConversation(c.id);
              }}
              onRename={(title) => {
                void renameConversation(c.id, title);
              }}
              onToggleStar={() => {
                void toggleStarConversation(c.id);
              }}
            />
          ))
        )}
      </ul>
      {currentHits !== null ? (
        <div className="chat-message-search" aria-label="Message search results">
          <div className="chat-message-search-head">Messages</div>
          {currentHits.length === 0 ? (
            <p className="chat-message-search-empty">No message matches</p>
          ) : (
            <ul className="chat-message-search-list">
              {currentHits.map((hit) => (
                <li key={hit.messageId} className="chat-message-search-row">
                  <button
                    type="button"
                    className="chat-message-search-btn"
                    onClick={() => openMessageHit(hit)}
                  >
                    <span className="chat-message-search-title">{hit.conversationTitle}</span>
                    <span className="chat-message-search-snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
  onRename,
  onToggleStar,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onToggleStar: () => void;
}): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the Cancel button when confirmation appears so Escape/Tab work naturally
  useEffect(() => {
    if (confirmingDelete) {
      cancelRef.current?.focus();
    }
  }, [confirmingDelete]);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  const beginEdit = (): void => {
    setDraftTitle(conversation.title);
    setEditing(true);
  };

  const commitEdit = (): void => {
    const next = draftTitle.trim();
    if (next.length > 0 && next !== conversation.title) onRename(next);
    setEditing(false);
  };

  const cancelEdit = (): void => {
    setDraftTitle(conversation.title);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className={`chat-conversation-row editing${active ? ' active' : ''}`}>
        <input
          ref={inputRef}
          className="chat-conversation-rename-input"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          aria-label={`Rename conversation "${conversation.title}"`}
        />
      </li>
    );
  }

  return (
    <li
      className={`chat-conversation-row${active ? ' active' : ''}${confirmingDelete ? ' confirming' : ''}`}
    >
      {confirmingDelete ? (
        <div
          className="chat-conversation-confirm-row"
          role="group"
          aria-label={`Confirm delete "${conversation.title}"`}
        >
          <span className="chat-conversation-confirm-label">Delete?</span>
          <div className="chat-conversation-confirm-actions">
            <button
              type="button"
              className="chat-conversation-confirm-delete btn btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              Delete
            </button>
            <button
              type="button"
              ref={cancelRef}
              className="chat-conversation-confirm-cancel btn"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                }
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="chat-conversation-btn"
            onClick={onSelect}
            onDoubleClick={(e) => {
              e.stopPropagation();
              beginEdit();
            }}
          >
            <span className="chat-conversation-title">{conversation.title}</span>
            <span
              className={`chat-conversation-meta chat-conversation-meta--${recencyOf(
                conversation.updatedAt,
                new Date(),
              )}`}
              title={new Date(conversation.updatedAt).toLocaleString()}
            >
              {relativeTime(conversation.updatedAt, new Date())}
            </span>
          </button>
          <button
            type="button"
            className={`chat-conversation-star${conversation.starred ? ' starred' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar();
            }}
            aria-label={
              conversation.starred ? `Unstar ${conversation.title}` : `Star ${conversation.title}`
            }
            aria-pressed={conversation.starred}
            title={conversation.starred ? 'Unstar' : 'Star'}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill={conversation.starred ? 'currentColor' : 'none'}
            >
              <path
                d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9 4.2 13.4l.7-4.3-3.1-3 4.3-.6L8 1.6z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="chat-conversation-rename"
            onClick={(e) => {
              e.stopPropagation();
              beginEdit();
            }}
            aria-label={`Rename ${conversation.title}`}
            title="Rename"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" fill="none">
              <path
                d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="chat-conversation-del"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmingDelete(true);
            }}
            aria-label={`Delete ${conversation.title}`}
          >
            ×
          </button>
        </>
      )}
    </li>
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
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M1.5 3.5a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .77.36l.78.93a1 1 0 0 0 .77.36H11.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="workspace-chip-label">{label}</span>
      <span className="workspace-chip-caret" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            d="M2.5 4l2.5 2.5L7.5 4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
    </button>
  );
}

function folderName(path: string): string {
  const cleaned = path.replace(/[\\/]$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
