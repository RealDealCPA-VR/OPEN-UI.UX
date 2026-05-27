import { useEffect, useState } from 'react';
import type { Conversation } from '../../../shared/conversation';
import { useChat } from '../../state/chat-context';
import { useSelectedModel } from '../../state/selected-model-context';

export default function ChatContextPane(): JSX.Element {
  const { conversations, activeId, selectConversation, createConversation, deleteConversation } =
    useChat();
  const { selected } = useSelectedModel();
  const [query, setQuery] = useState('');

  const filtered =
    query.trim().length === 0
      ? conversations
      : conversations.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="lcc-pane lcc-pane-chat">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Conversations</span>
      </div>
      <WorkspaceChip />
      <div className="lcc-pane-toolbar">
        <button
          type="button"
          className="btn btn-primary lcc-pane-new"
          onClick={() => {
            void createConversation(selected?.providerId ?? null, selected?.modelId ?? null);
          }}
        >
          + New chat
        </button>
        <input
          type="search"
          className="lcc-pane-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search conversations"
        />
      </div>
      <ul className="chat-conversation-list">
        {filtered.length === 0 ? (
          <li className="chat-conversation-empty">
            {conversations.length === 0 ? 'No conversations yet' : 'No matches'}
          </li>
        ) : (
          filtered.map((c) => (
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
