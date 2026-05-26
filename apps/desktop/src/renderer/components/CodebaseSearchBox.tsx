import { useEffect, useRef, useState } from 'react';
import type { CodebaseSearchHit, CodebaseSearchMode } from '../../shared/codebase-search';

interface CodebaseSearchBoxProps {
  workspaceRoot: string | null;
  onPick: (hit: CodebaseSearchHit) => void;
  /** When set, the search box uses these as a fixed pre-filter (e.g. from a chat transfer). */
  pinnedPaths?: string[];
  onClearPinned?: () => void;
}

const DEBOUNCE_MS = 300;

export function CodebaseSearchBox({
  workspaceRoot,
  onPick,
  pinnedPaths,
  onClearPinned,
}: CodebaseSearchBoxProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<CodebaseSearchMode>('both');
  const [hits, setHits] = useState<CodebaseSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || !workspaceRoot) return;
    const reqId = ++reqIdRef.current;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await window.opencodex.codebase.search({
          workspaceRoot,
          query: query.trim(),
          mode,
        });
        if (reqIdRef.current !== reqId) return;
        setHits(res.hits);
        setOpen(true);
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : String(err));
        setHits([]);
      } finally {
        if (reqIdRef.current === reqId) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, mode, workspaceRoot]);

  const hasQuery = query.trim().length > 0 && !!workspaceRoot;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="codebase-search-box" ref={boxRef}>
      <div className="codebase-search-row">
        <input
          type="text"
          className="codebase-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (hasQuery && hits.length > 0) setOpen(true);
          }}
          placeholder={
            workspaceRoot ? 'Search filenames or content…' : 'Pick a workspace to search'
          }
          disabled={!workspaceRoot}
        />
        <div className="codebase-search-modes" role="tablist">
          {(['both', 'filename', 'content'] as CodebaseSearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'codebase-search-mode active' : 'codebase-search-mode'}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {searching && <span className="codebase-search-status">…</span>}
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
            <button
              type="button"
              className="codebase-search-pinned-clear"
              onClick={onClearPinned}
              aria-label="Clear pinned paths"
            >
              ×
            </button>
          )}
        </div>
      )}
      {error && <p className="approvals-save-error codebase-search-error">{error}</p>}
      {open && hasQuery && hits.length > 0 && (
        <ul className="codebase-search-results" role="listbox">
          {hits.map((hit, idx) => (
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
                  {hit.kind === 'filename' ? 'file' : `:${hit.line}`}
                </span>
                <code className="codebase-search-path">{hit.path}</code>
                {hit.snippet && <span className="codebase-search-snippet">{hit.snippet}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && hits.length === 0 && !searching && query.trim() && (
        <div className="codebase-search-empty">No matches.</div>
      )}
    </div>
  );
}
