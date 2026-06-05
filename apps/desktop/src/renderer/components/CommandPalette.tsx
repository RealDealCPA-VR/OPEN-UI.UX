import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './CommandPalette.css';
import type { ConversationSearchHit } from '../../shared/conversation-search';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import type { Skill } from '../../shared/skills';
import { getBridge } from '../bridge';
import { buildPaletteActions } from './command-palette-actions';
import {
  flattenForKeyboardNav,
  groupByCategory,
  mergePaletteResults,
  type PaletteCategory,
  type PaletteEntry,
  type PaletteMcpTool,
} from './command-palette-derive';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts?: () => void;
}

const DEBOUNCE_MS = 140;
const SEARCH_LIMIT = 20;

const CATEGORY_LABELS: Record<PaletteCategory, string> = {
  action: 'Actions',
  message: 'Messages',
  file: 'Files',
  skill: 'Skills',
  'mcp-tool': 'MCP Tools',
};

interface Bridge {
  search: (req: { query: string; limit?: number }) => Promise<{
    hits: ConversationSearchHit[];
    truncated: boolean;
  }>;
}

function conversationsSearchBridge(): Bridge | null {
  const w = window as unknown as {
    opencodex?: {
      conversations?: {
        search?: Bridge['search'];
      };
    };
  };
  const fn = w.opencodex?.conversations?.search;
  return fn ? { search: fn } : null;
}

export function CommandPalette({
  open,
  onClose,
  onOpenShortcuts,
}: CommandPaletteProps): JSX.Element | null {
  const navigate = useNavigate();
  const actions = useMemo(
    () =>
      buildPaletteActions({
        navigate,
        openShortcuts: onOpenShortcuts ?? (() => undefined),
      }),
    [navigate, onOpenShortcuts],
  );
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [messageHits, setMessageHits] = useState<ConversationSearchHit[]>([]);
  const [fileHits, setFileHits] = useState<CodebaseSearchHit[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpTools, setMcpTools] = useState<PaletteMcpTool[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) return;
    queueMicrotask(() => {
      setQuery('');
      setDebouncedQuery('');
      setMessageHits([]);
      setFileHits([]);
      setActiveIndex(0);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void bridge.workspace
        .get()
        .then((s) => {
          if (!cancelled) setWorkspaceRoot(s.active);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void bridge.skills
        .list()
        .then((res) => {
          if (!cancelled) setSkills(res.skills);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void bridge.mcp
        .list()
        .then(async (state) => {
          if (cancelled) return;
          const connectedServers = state.servers.filter(
            (s) => state.status[s.id]?.status === 'connected',
          );
          const collected: PaletteMcpTool[] = [];
          await Promise.all(
            connectedServers.map(async (server) => {
              try {
                const res = await bridge.mcp.listServerTools({ serverId: server.id });
                for (const tool of res.tools) {
                  collected.push({
                    serverId: server.id,
                    serverDisplayName: server.displayName,
                    toolName: tool.name,
                    ...(tool.description !== undefined ? { description: tool.description } : {}),
                  });
                }
              } catch {
                // ignore — server may have disconnected mid-fetch
              }
            }),
          );
          if (!cancelled) setMcpTools(collected);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!debouncedQuery) {
        setMessageHits([]);
        setFileHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const bridge = conversationsSearchBridge();
      const messagesPromise: Promise<{ hits: ConversationSearchHit[] }> = bridge
        ? bridge.search({ query: debouncedQuery, limit: SEARCH_LIMIT })
        : Promise.resolve({ hits: [] });

      const codebaseBridge = getBridge()?.codebase;
      const filesPromise: Promise<CodebaseSearchHit[]> =
        workspaceRoot && codebaseBridge
          ? codebaseBridge
              .search({
                workspaceRoot,
                query: debouncedQuery,
                mode: 'both',
                limit: SEARCH_LIMIT,
              })
              .then((res) => res.hits)
              .catch(() => [])
          : Promise.resolve([]);

      Promise.all([messagesPromise, filesPromise])
        .then(([m, f]) => {
          if (cancelled) return;
          setMessageHits(m.hits);
          setFileHits(f);
          setActiveIndex(0);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, workspaceRoot, open]);

  const entries = useMemo(
    () =>
      mergePaletteResults(messageHits, fileHits, skills, debouncedQuery, {
        mcpTools,
        actions,
      }),
    [messageHits, fileHits, skills, debouncedQuery, mcpTools, actions],
  );

  const navEntries = useMemo(() => flattenForKeyboardNav(entries), [entries]);
  const grouped = useMemo(() => groupByCategory(entries), [entries]);

  const handleSelect = useCallback(
    (entry: PaletteEntry) => {
      if (entry.message) {
        const hit = entry.message;
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
        onClose();
        return;
      }
      if (entry.file) {
        const hit = entry.file;
        navigate(`/codebase?file=${encodeURIComponent(hit.path)}`);
        onClose();
        return;
      }
      if (entry.skill) {
        navigate(`/settings/skills?highlight=${encodeURIComponent(entry.skill.id)}`);
        onClose();
        return;
      }
      if (entry.mcpTool) {
        const tool = entry.mcpTool;
        window.dispatchEvent(
          new CustomEvent('mcp:open-tool-runner', {
            detail: { serverId: tool.serverId, toolName: tool.toolName },
          }),
        );
        onClose();
        return;
      }
      if (entry.action) {
        // Close first so navigation/state changes happen on a clean stack.
        onClose();
        entry.action.perform();
        return;
      }
    },
    [navigate, onClose],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (navEntries.length === 0) return;
        setActiveIndex((i) => (i + 1) % navEntries.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (navEntries.length === 0) return;
        setActiveIndex((i) => (i - 1 + navEntries.length) % navEntries.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = navEntries[activeIndex];
        if (entry) handleSelect(entry);
      }
    },
    [navEntries, activeIndex, handleSelect, onClose],
  );

  if (!open) return null;

  const totalCount = navEntries.length;

  return (
    <div
      className="command-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      onKeyDown={handleKey}
    >
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        role="combobox"
        aria-expanded={totalCount > 0}
        aria-haspopup="listbox"
      >
        <div className="command-palette-input-row">
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            value={query}
            placeholder="Search messages, files, skills — or type a command (try “theme”, “settings”, “?”)"
            aria-label="Search query"
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {loading ? (
            <span className="mcp-inline-spinner" role="status" aria-label="Loading" />
          ) : null}
        </div>
        <div className="command-palette-results" role="listbox" aria-label="Search results">
          {totalCount === 0 ? (
            <div className="command-palette-empty">
              {debouncedQuery
                ? 'No results.'
                : 'Type to search messages, files, skills — or run a command.'}
            </div>
          ) : (
            (Object.keys(grouped) as PaletteCategory[]).map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) return null;
              return (
                <div key={cat} className="command-palette-group">
                  <div className="command-palette-group-label">{CATEGORY_LABELS[cat]}</div>
                  {items.map((entry) => {
                    const idx = navEntries.indexOf(entry);
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        className={isActive ? 'command-palette-row active' : 'command-palette-row'}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => handleSelect(entry)}
                      >
                        <span className="command-palette-row-title">{entry.title}</span>
                        <span className="command-palette-row-subtitle">{entry.subtitle}</span>
                        {entry.detail ? (
                          <span className="command-palette-row-detail">{entry.detail}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="command-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
