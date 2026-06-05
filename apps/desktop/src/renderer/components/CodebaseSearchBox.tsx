import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import { getBridge } from '../bridge';
import { HoverHint } from './HoverHint';

type SearchScope = 'current-dir' | 'repo' | 'mcp';

interface ScopeOption {
  id: SearchScope;
  label: string;
  hint: string;
}

const SCOPES: ScopeOption[] = [
  { id: 'current-dir', label: 'Current dir', hint: 'Search the active subfolder' },
  { id: 'repo', label: 'Repo', hint: 'Search the whole workspace' },
  { id: 'mcp', label: 'MCP resources', hint: 'Search connected MCP servers' },
];

interface CodebaseSearchBoxProps {
  workspaceRoot: string | null;
  onPick: (hit: CodebaseSearchHit) => void;
  /** When set, the search box uses these as a fixed pre-filter (e.g. from a chat transfer). */
  pinnedPaths?: string[];
  onClearPinned?: () => void;
  /** Optional sub-path that scopes the "Current dir" chip. */
  currentDir?: string | null;
}

interface SearchResult {
  hits: CodebaseSearchHit[];
  timingMs: number;
}

const DEBOUNCE_MS = 300;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || '');
}

interface HighlightedProps {
  text: string;
  query: string;
}

function HighlightedSnippet({ text, query }: HighlightedProps): JSX.Element {
  const term = query.trim();
  if (!term) return <>{text}</>;
  const re = new RegExp(escapeRegExp(term), 'ig');
  const out: Array<string | JSX.Element> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={i++}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function CodebaseSearchBox({
  workspaceRoot,
  onPick,
  pinnedPaths,
  onClearPinned,
  currentDir,
}: CodebaseSearchBoxProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('repo');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const reqIdRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isMac = isMacPlatform();
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && (e.key === 'f' || e.key === 'F')) {
        if (inputRef.current && document.activeElement !== inputRef.current) {
          e.preventDefault();
          inputRef.current.focus();
          inputRef.current.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    const handle = window.setTimeout(async () => {
      const bridge = getBridge();
      if (!bridge) return;
      setSearching(true);
      setError(null);
      const startedAt = performance.now();
      try {
        if (scope === 'mcp') {
          const entries = await bridge.mcp.listResources();
          if (reqIdRef.current !== reqId) return;
          const q = trimmed.toLowerCase();
          const hits: CodebaseSearchHit[] = entries
            .filter((e) => {
              const r = e.resource;
              return (
                r.uri.toLowerCase().includes(q) ||
                r.name.toLowerCase().includes(q) ||
                (r.description ? r.description.toLowerCase().includes(q) : false)
              );
            })
            .map((e) => ({
              path: e.resource.uri,
              kind: 'filename' as const,
              snippet: e.resource.description ?? e.resource.name,
            }));
          setResult({ hits, timingMs: performance.now() - startedAt });
          setOpen(true);
          return;
        }
        if (!workspaceRoot) {
          setResult({ hits: [], timingMs: 0 });
          setOpen(true);
          return;
        }
        const res = await bridge.codebase.search({
          workspaceRoot,
          query: trimmed,
          mode: 'both',
        });
        if (reqIdRef.current !== reqId) return;
        let hits = res.hits;
        if (scope === 'current-dir' && currentDir) {
          const prefix = currentDir.replace(/\\/g, '/');
          hits = hits.filter((h) => h.path.replace(/\\/g, '/').startsWith(prefix));
        }
        setResult({ hits, timingMs: performance.now() - startedAt });
        setOpen(true);
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : String(err));
        setResult({ hits: [], timingMs: performance.now() - startedAt });
      } finally {
        if (reqIdRef.current === reqId) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, scope, workspaceRoot, currentDir]);

  const hasQuery = query.trim().length > 0;
  const inputDisabled = scope !== 'mcp' && !workspaceRoot;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const refocusHint = useMemo(() => (isMacPlatform() ? '⌘F to refocus' : 'Ctrl+F to refocus'), []);

  const placeholder = useMemo(() => {
    if (scope === 'mcp')
      return focused ? 'Search MCP resources…' : `Search MCP resources… (${refocusHint})`;
    if (!workspaceRoot) return 'Pick a workspace to search';
    return focused
      ? 'Search filenames or content…'
      : `Search filenames or content… (${refocusHint})`;
  }, [scope, workspaceRoot, focused, refocusHint]);

  const trimmedQuery = query.trim();

  return (
    <div className="codebase-search-box" ref={boxRef}>
      <div className="codebase-search-row">
        <input
          ref={inputRef}
          type="text"
          className="codebase-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setFocused(true);
            if (hasQuery && result && result.hits.length > 0) setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={inputDisabled}
        />
        <div className="codebase-search-modes" role="tablist" aria-label="Search scope">
          {SCOPES.map((s) => {
            const disabled = s.id === 'current-dir' && !currentDir;
            return (
              <HoverHint key={s.id} hint={s.hint}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === s.id}
                  className={
                    scope === s.id ? 'codebase-search-mode active' : 'codebase-search-mode'
                  }
                  onClick={() => setScope(s.id)}
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  title={disabled ? 'No current directory selected' : undefined}
                >
                  {s.label}
                </button>
              </HoverHint>
            );
          })}
        </div>
        {searching && (
          <span className="codebase-search-status" aria-label="Searching…">
            <span className="mcp-inline-spinner" aria-hidden="true" />
          </span>
        )}
        {!searching && result && hasQuery ? (
          <span
            className="codebase-search-timing"
            aria-live="polite"
            style={{
              fontSize: 11,
              color: 'var(--text-muted, #888)',
              padding: '0 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {result.hits.length} result{result.hits.length === 1 ? '' : 's'} ·{' '}
            {Math.max(1, Math.round(result.timingMs))}ms
          </span>
        ) : null}
      </div>
      {pinnedPaths && pinnedPaths.length > 0 && (
        <div className="codebase-search-pinned">
          <span className="codebase-search-pinned-label">From chat:</span>
          {pinnedPaths.map((p) => (
            <button
              key={p}
              type="button"
              className="codebase-search-pinned-chip"
              onClick={() => onPick({ path: p, kind: 'filename' })}
              title={p}
            >
              {p}
            </button>
          ))}
          {onClearPinned && (
            <HoverHint hint="Clear pinned paths">
              <button
                type="button"
                className="codebase-search-pinned-clear"
                onClick={onClearPinned}
                aria-label="Clear pinned paths"
              >
                ×
              </button>
            </HoverHint>
          )}
        </div>
      )}
      {error && <p className="approvals-save-error codebase-search-error">{error}</p>}
      {open && hasQuery && result && result.hits.length > 0 && (
        <ul className="codebase-search-results" role="listbox">
          {result.hits.map((hit, idx) => (
            <li key={`${hit.kind}-${hit.path}-${hit.line ?? ''}-${idx}`}>
              <button
                type="button"
                className="codebase-search-result"
                onClick={() => {
                  onPick(hit);
                  setOpen(false);
                }}
              >
                <span className={`codebase-search-kind codebase-search-kind-${hit.kind}`}>
                  {hit.kind === 'filename'
                    ? 'file'
                    : hit.kind === 'folder'
                      ? 'folder'
                      : `:${hit.line}`}
                </span>
                <code className="codebase-search-path">
                  <HighlightedSnippet text={hit.path} query={trimmedQuery} />
                </code>
                {hit.snippet && (
                  <span className="codebase-search-snippet">
                    <HighlightedSnippet text={hit.snippet} query={trimmedQuery} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && result && result.hits.length === 0 && !searching && trimmedQuery && (
        <div className="codebase-search-empty">No matches.</div>
      )}
    </div>
  );
}
