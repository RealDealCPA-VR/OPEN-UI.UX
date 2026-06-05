import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../../../shared/conversation';
import { useChat } from '../../state/chat-context';
import { useSelectedModel } from '../../state/selected-model-context';
import { MultiWorkspaceSelector } from '../MultiWorkspaceSelector';
import { SuggestionsPane } from '../SuggestionsPane';

export default function ChatContextPane(): JSX.Element {
  const { conversations, activeId, selectConversation, createConversation, deleteConversation } =
    useChat();
  const { selected } = useSelectedModel();
  const [query, setQuery] = useState('');
  // Lane 15 — switch between Conversations list and Pair Suggestions
  const [tab, setTab] = useState<'conversations' | 'suggestions'>('conversations');

  const filtered =
    query.trim().length === 0
      ? conversations
      : conversations.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));

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
      <div className="lcc-pane-head lcc-pane-head-chat">
        <span className="lcc-pane-title">Conversations</span>
        <button
          type="button"
          className="lcc-pane-new-icon"
          onClick={() => {
            void createConversation(selected?.providerId ?? null, selected?.modelId ?? null);
          }}
          aria-label="New chat"
          title="New chat"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M7 2.5v9M2.5 7h9"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div className="lcc-pane-search-row">
        <span className="lcc-pane-search-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          className="lcc-pane-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
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
            />
          ))
        )}
      </ul>
    </div>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the Cancel button when confirmation appears so Escape/Tab work naturally
  useEffect(() => {
    if (confirmingDelete) {
      cancelRef.current?.focus();
    }
  }, [confirmingDelete]);

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
