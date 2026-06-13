import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from '../../../shared/conversation';
import type { ConversationSearchHit } from '../../../shared/conversation-search';
import type { Project } from '../../../shared/projects';
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
    projects,
    createProject,
    deleteProject,
    setProjectInstructions,
    assignConversationToProject,
  } = useChat();
  const { selected } = useSelectedModel();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Lane 15 — switch between Conversations list and Pair Suggestions
  const [tab, setTab] = useState<'conversations' | 'suggestions'>('conversations');

  // Cmd/Ctrl+K focuses the conversation/message search — unless the user is
  // typing in another field (mirrors AppShell's isEditableTarget guard), so it
  // can't hijack focus from the composer or an inline-rename input.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target === searchRef.current) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        if (isEditableTarget(e.target)) return;
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

  // CD-21 — group assigned conversations under their project; a conversation
  // pointing at an unknown project (stale broadcast) stays in the flat list.
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const projectInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (creatingProject) projectInputRef.current?.focus();
  }, [creatingProject]);
  const knownProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const byProject = useMemo(() => {
    const groups = new Map<string, Conversation[]>();
    for (const c of filtered) {
      if (c.projectId && knownProjectIds.has(c.projectId)) {
        const group = groups.get(c.projectId) ?? [];
        group.push(c);
        groups.set(c.projectId, group);
      }
    }
    return groups;
  }, [filtered, knownProjectIds]);
  const ungrouped = useMemo(
    () => filtered.filter((c) => !c.projectId || !knownProjectIds.has(c.projectId)),
    [filtered, knownProjectIds],
  );

  const commitProjectDraft = (): void => {
    const name = projectDraft.trim();
    if (name.length > 0) void createProject(name);
    setProjectDraft('');
    setCreatingProject(false);
  };

  const rowProps = (c: Conversation): Parameters<typeof ConversationRow>[0] => ({
    conversation: c,
    active: c.id === activeId,
    projects,
    onSelect: () => selectConversation(c.id),
    onDelete: () => {
      void deleteConversation(c.id);
    },
    onRename: (title: string) => {
      void renameConversation(c.id, title);
    },
    onToggleStar: () => {
      void toggleStarConversation(c.id);
    },
    onAssignProject: (projectId: string | null) => {
      void assignConversationToProject(c.id, projectId);
    },
  });

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
      <div className="chat-projects-head">
        <span>Projects</span>
        <button
          type="button"
          className="chat-project-add"
          onClick={() => setCreatingProject(true)}
          aria-label="New project"
          title="New project"
        >
          +
        </button>
      </div>
      {creatingProject ? (
        <input
          className="chat-conversation-rename-input chat-project-name-input"
          value={projectDraft}
          onChange={(e) => setProjectDraft(e.target.value)}
          onBlur={commitProjectDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitProjectDraft();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setProjectDraft('');
              setCreatingProject(false);
            }
          }}
          placeholder="Project name"
          aria-label="New project name"
          ref={projectInputRef}
        />
      ) : null}
      {projects.length > 0 ? (
        <ul className="chat-project-list">
          {projects.map((p) => (
            <ProjectGroup
              key={p.id}
              project={p}
              conversations={byProject.get(p.id) ?? []}
              renderRow={(c) => <ConversationRow key={c.id} {...rowProps(c)} />}
              onDelete={() => {
                void deleteProject(p.id);
              }}
              onSaveInstructions={(instructions) => {
                void setProjectInstructions(p.id, instructions);
              }}
            />
          ))}
        </ul>
      ) : null}
      <ul className="chat-conversation-list">
        {filtered.length === 0 ? (
          <li className="chat-conversation-empty">
            {conversations.length === 0
              ? 'No conversations yet. Start one with “+ New chat”.'
              : 'No matches'}
          </li>
        ) : (
          ungrouped.map((c) => <ConversationRow key={c.id} {...rowProps(c)} />)
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

function ProjectGroup({
  project,
  conversations,
  renderRow,
  onDelete,
  onSaveInstructions,
}: {
  project: Project;
  conversations: Conversation[];
  renderRow: (c: Conversation) => JSX.Element;
  onDelete: () => void;
  onSaveInstructions: (instructions: string) => void;
}): JSX.Element {
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [draft, setDraft] = useState(project.instructions);

  return (
    <li className="chat-project-group">
      <div className="chat-project-header">
        <span className="chat-project-name" title={project.name}>
          {project.name}
        </span>
        <button
          type="button"
          className="chat-project-action"
          onClick={() => {
            setDraft(project.instructions);
            setEditingInstructions((open) => !open);
          }}
          aria-label={`Edit instructions for ${project.name}`}
          title="Project instructions"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" fill="none">
            <path
              d="M3 2.5h8M3 5.5h8M3 8.5h5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <path
              d="M10.2 9l1.3 1.3L8 13.8l-1.7.4.4-1.7L10.2 9z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="chat-project-action chat-project-delete"
          onClick={onDelete}
          aria-label={`Delete project ${project.name}`}
          title="Delete project (conversations are kept)"
        >
          ×
        </button>
      </div>
      {editingInstructions ? (
        <div className="chat-project-instructions">
          <textarea
            className="chat-project-instructions-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Custom instructions for every chat in this project…"
            aria-label={`Instructions for ${project.name}`}
          />
          <div className="chat-project-instructions-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                onSaveInstructions(draft);
                setEditingInstructions(false);
              }}
            >
              Save
            </button>
            <button type="button" className="btn" onClick={() => setEditingInstructions(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <ul className="chat-conversation-list chat-project-conversations">
        {conversations.length === 0 ? (
          <li className="chat-project-empty">No conversations</li>
        ) : (
          conversations.map(renderRow)
        )}
      </ul>
    </li>
  );
}

function ConversationRow({
  conversation,
  active,
  projects,
  onSelect,
  onDelete,
  onRename,
  onToggleStar,
  onAssignProject,
}: {
  conversation: Conversation;
  active: boolean;
  projects: Project[];
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onToggleStar: () => void;
  onAssignProject: (projectId: string | null) => void;
}): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [assigning, setAssigning] = useState(false);
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

  if (assigning) {
    return (
      <li className={`chat-conversation-row editing${active ? ' active' : ''}`}>
        <select
          className="chat-conversation-project-select"
          value={conversation.projectId ?? ''}
          onChange={(e) => {
            const next = e.target.value === '' ? null : e.target.value;
            setAssigning(false);
            if (next !== (conversation.projectId ?? null)) onAssignProject(next);
          }}
          onBlur={() => setAssigning(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setAssigning(false);
            }
          }}
          aria-label={`Move ${conversation.title} to project`}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
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
          {projects.length > 0 ? (
            <button
              type="button"
              className="chat-conversation-project"
              onClick={(e) => {
                e.stopPropagation();
                setAssigning(true);
              }}
              aria-label={`Move ${conversation.title} to a project`}
              title="Move to project"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" fill="none">
                <path
                  d="M1.5 3.5a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .77.36l.78.93a1 1 0 0 0 .77.36H11.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
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
