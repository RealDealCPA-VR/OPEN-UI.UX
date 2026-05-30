import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PendingEditAnnotation } from '../views/codebase-pending-edits-derive';
import { getBridge } from '../bridge';
// Note: codebase-pending-edits-derive.ts imports the `EditAnnotation` type from
// this file. The cycle is type-only on both sides (verbatim type imports), so
// it is safely erased at runtime.

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren: boolean;
}

export type EditAnnotation = 'pending' | 'applied' | 'rejected';

interface FileTreeProps {
  annotations?: Record<string, PendingEditAnnotation>;
  onOpenFile?: (path: string) => void;
  onContextMenu?: (path: string, isDirectory: boolean, x: number, y: number) => void;
  onOpenPendingEdit?: (path: string, runIds: string[]) => void;
}

interface NodeState {
  entries: FileNode[];
  expanded: boolean;
  loading: boolean;
}

interface FlatRow {
  node: FileNode;
  depth: number;
  expanded: boolean;
  childLoading: boolean;
}

const VIRTUAL_THRESHOLD = 500;
const ROW_HEIGHT = 24;
const VIRTUAL_BUFFER = 10;
const FILTER_DEBOUNCE_MS = 150;

export function FileTree({
  annotations,
  onOpenFile,
  onContextMenu,
  onOpenPendingEdit,
}: FileTreeProps): JSX.Element {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [root, setRoot] = useState<NodeState>({ entries: [], expanded: true, loading: true });
  const [children, setChildren] = useState<Record<string, NodeState>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const [rawFilter, setRawFilter] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    (async () => {
      const result = await bridge.fileTree.list();
      if (cancelled) return;
      setWorkspaceRoot(result.workspaceRoot);
      setRoot({ entries: result.entries, expanded: true, loading: false });
      setChildren({});
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.workspace.onChanged(() => setReloadKey((k) => k + 1));
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setFilter(rawFilter.trim().toLowerCase()),
      FILTER_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(handle);
  }, [rawFilter]);

  const toggle = useCallback(
    async (path: string, force?: 'expand' | 'collapse'): Promise<void> => {
      const current = children[path];
      const wantExpand =
        force === 'expand' ? true : force === 'collapse' ? false : !current?.expanded;
      if (!wantExpand) {
        if (current) {
          setChildren((prev) => ({ ...prev, [path]: { ...current, expanded: false } }));
        }
        return;
      }
      if (current?.entries.length) {
        setChildren((prev) => ({ ...prev, [path]: { ...current, expanded: true } }));
        return;
      }
      setChildren((prev) => ({
        ...prev,
        [path]: { entries: [], expanded: true, loading: true },
      }));
      const bridge = getBridge();
      if (!bridge) return;
      const result = await bridge.fileTree.list(path);
      setChildren((prev) => ({
        ...prev,
        [path]: { entries: result.entries, expanded: true, loading: false },
      }));
    },
    [children],
  );

  const flatRows = useMemo<FlatRow[]>(() => {
    if (root.loading) return [];
    const out: FlatRow[] = [];
    const walk = (entries: FileNode[], depth: number): void => {
      for (const e of entries) {
        const child = children[e.path];
        out.push({
          node: e,
          depth,
          expanded: !!child?.expanded,
          childLoading: !!child?.loading,
        });
        if (e.isDirectory && child?.expanded && child.entries.length > 0) {
          walk(child.entries, depth + 1);
        }
      }
    };
    walk(root.entries, 0);
    return out;
  }, [root, children]);

  const visibleRows = useMemo<FlatRow[]>(() => {
    if (!filter) return flatRows;
    const matchSet = new Set<string>();
    const ancestorOpen = new Set<string>();
    const matchTest = (name: string): boolean => name.toLowerCase().includes(filter);
    // First pass: collect direct matches across loaded subtree.
    const visit = (entries: FileNode[], parents: string[]): void => {
      for (const e of entries) {
        if (matchTest(e.name)) {
          matchSet.add(e.path);
          for (const p of parents) ancestorOpen.add(p);
        }
        if (e.isDirectory) {
          const child = children[e.path];
          if (child?.entries.length) visit(child.entries, [...parents, e.path]);
        }
      }
    };
    visit(root.entries, []);
    // Re-flatten honoring matches and auto-expanded ancestors.
    const out: FlatRow[] = [];
    const walk = (entries: FileNode[], depth: number, parentMatched: boolean): void => {
      for (const e of entries) {
        const directMatch = matchSet.has(e.path);
        const isAncestor = ancestorOpen.has(e.path);
        const includeSelf = directMatch || isAncestor || parentMatched;
        const child = children[e.path];
        const expandedForFilter =
          isAncestor || (parentMatched && child?.expanded) || !!child?.expanded;
        if (includeSelf) {
          out.push({
            node: e,
            depth,
            expanded: expandedForFilter,
            childLoading: !!child?.loading,
          });
        }
        if (e.isDirectory && child?.entries.length && (isAncestor || parentMatched)) {
          walk(child.entries, depth + 1, parentMatched || directMatch);
        } else if (e.isDirectory && child?.entries.length && child.expanded) {
          walk(child.entries, depth + 1, false);
        }
      }
    };
    walk(root.entries, 0, false);
    return out;
  }, [flatRows, filter, root, children]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !visibleRows.some((r) => r.node.path === selectedPath)) {
      setSelectedPath(visibleRows[0]?.node.path ?? null);
    }
  }, [visibleRows, selectedPath]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    setViewportH(node.clientHeight);
    const onResize = (): void => setViewportH(node.clientHeight);
    const ro = new ResizeObserver(onResize);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const useVirtualization = visibleRows.length > VIRTUAL_THRESHOLD;
  const totalHeight = visibleRows.length * ROW_HEIGHT;
  const sliceStart = useVirtualization
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_BUFFER)
    : 0;
  const sliceCount = useVirtualization
    ? Math.ceil(viewportH / ROW_HEIGHT) + VIRTUAL_BUFFER * 2
    : visibleRows.length;
  const sliceEnd = Math.min(visibleRows.length, sliceStart + sliceCount);
  const renderRows = useVirtualization ? visibleRows.slice(sliceStart, sliceEnd) : visibleRows;
  const topPad = useVirtualization ? sliceStart * ROW_HEIGHT : 0;

  const moveSelection = useCallback(
    (delta: number) => {
      if (visibleRows.length === 0) return;
      const idx = visibleRows.findIndex((r) => r.node.path === selectedPath);
      const next = Math.max(0, Math.min(visibleRows.length - 1, (idx >= 0 ? idx : 0) + delta));
      const targetPath = visibleRows[next]?.node.path ?? null;
      setSelectedPath(targetPath);
      if (targetPath && scrollRef.current) {
        const rowTop = next * ROW_HEIGHT;
        const rowBot = rowTop + ROW_HEIGHT;
        const viewTop = scrollRef.current.scrollTop;
        const viewBot = viewTop + scrollRef.current.clientHeight;
        if (rowTop < viewTop) scrollRef.current.scrollTop = rowTop;
        else if (rowBot > viewBot)
          scrollRef.current.scrollTop = rowBot - scrollRef.current.clientHeight;
      }
    },
    [visibleRows, selectedPath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target instanceof HTMLInputElement) return;
      if (visibleRows.length === 0) return;
      const idx = visibleRows.findIndex((r) => r.node.path === selectedPath);
      const row = idx >= 0 ? visibleRows[idx] : undefined;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (row?.node.isDirectory && !row.expanded) void toggle(row.node.path, 'expand');
        else if (row?.node.isDirectory && row.expanded) moveSelection(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (row?.node.isDirectory && row.expanded) void toggle(row.node.path, 'collapse');
        else if (row) {
          // Jump to parent if any.
          const parentDepth = row.depth - 1;
          if (parentDepth >= 0) {
            for (let i = idx - 1; i >= 0; i--) {
              const r = visibleRows[i];
              if (r && r.depth === parentDepth) {
                setSelectedPath(r.node.path);
                break;
              }
            }
          }
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!row) return;
        if (row.node.isDirectory) void toggle(row.node.path);
        else onOpenFile?.(row.node.path);
      }
    },
    [visibleRows, selectedPath, moveSelection, toggle, onOpenFile],
  );

  if (!workspaceRoot) {
    return <p className="settings-section-desc">Pick a workspace in Settings → Workspace.</p>;
  }

  return (
    <div
      className="file-tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', outline: 'none' }}
    >
      <div className="file-tree-root">{workspaceRoot}</div>
      <div className="file-tree-filter" style={{ padding: '4px 6px' }}>
        <input
          type="text"
          value={rawFilter}
          onChange={(e) => setRawFilter(e.target.value)}
          placeholder="Filter files…"
          aria-label="Filter files"
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: 12,
            background: 'var(--bg-input, transparent)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border, #333)',
            borderRadius: 6,
            outline: 'none',
          }}
        />
      </div>
      {root.loading ? (
        <div className="file-tree-loading">Loading…</div>
      ) : visibleRows.length === 0 ? (
        <div className="file-tree-loading" style={{ padding: '8px 12px' }}>
          {filter ? `No matches for "${rawFilter.trim()}"` : 'Empty workspace'}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflow: 'auto', position: 'relative' }}
          className="file-tree-scroll"
        >
          {useVirtualization ? (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${topPad}px)` }}>
                {renderRows.map((r) => (
                  <FileTreeRowView
                    key={r.node.path}
                    row={r}
                    selected={r.node.path === selectedPath}
                    annotation={annotations?.[r.node.path]}
                    rowHeight={ROW_HEIGHT}
                    onSelect={() => setSelectedPath(r.node.path)}
                    onToggle={() => void toggle(r.node.path)}
                    onOpen={() => onOpenFile?.(r.node.path)}
                    onContextMenu={onContextMenu}
                    onOpenPendingEdit={onOpenPendingEdit}
                    refMap={rowRefs}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div>
              {renderRows.map((r) => (
                <FileTreeRowView
                  key={r.node.path}
                  row={r}
                  selected={r.node.path === selectedPath}
                  annotation={annotations?.[r.node.path]}
                  rowHeight={ROW_HEIGHT}
                  onSelect={() => setSelectedPath(r.node.path)}
                  onToggle={() => void toggle(r.node.path)}
                  onOpen={() => onOpenFile?.(r.node.path)}
                  onContextMenu={onContextMenu}
                  onOpenPendingEdit={onOpenPendingEdit}
                  refMap={rowRefs}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FileTreeRowViewProps {
  row: FlatRow;
  selected: boolean;
  annotation: PendingEditAnnotation | undefined;
  rowHeight: number;
  onSelect: () => void;
  onToggle: () => void;
  onOpen: () => void;
  onContextMenu?: (path: string, isDirectory: boolean, x: number, y: number) => void;
  onOpenPendingEdit?: (path: string, runIds: string[]) => void;
  refMap: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

function FileTreeRowView({
  row,
  selected,
  annotation,
  rowHeight,
  onSelect,
  onToggle,
  onOpen,
  onContextMenu,
  onOpenPendingEdit,
  refMap,
}: FileTreeRowViewProps): JSX.Element {
  const { node, depth, expanded, childLoading } = row;

  const handleClick = (): void => {
    onSelect();
    if (node.isDirectory) onToggle();
    else onOpen();
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!onContextMenu) return;
    e.preventDefault();
    onSelect();
    onContextMenu(node.path, node.isDirectory, e.clientX, e.clientY);
  };

  return (
    <div className="file-tree-node" style={{ height: rowHeight }}>
      <button
        type="button"
        ref={(el) => {
          if (el) refMap.current.set(node.path, el);
          else refMap.current.delete(node.path);
        }}
        className="file-tree-row"
        aria-selected={selected}
        data-selected={selected ? 'true' : undefined}
        style={{
          paddingLeft: `${depth * 14 + 6}px`,
          width: '100%',
          height: rowHeight,
          background: selected ? 'var(--bg-selected, rgba(77,154,255,0.12))' : undefined,
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="file-tree-icon">
          {node.isDirectory ? (childLoading ? '…' : expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="file-tree-name">{node.name}</span>
        {annotation && (
          <span
            role={onOpenPendingEdit ? 'button' : undefined}
            tabIndex={onOpenPendingEdit ? 0 : -1}
            className={`file-tree-annotation file-tree-annotation-${annotation.status}`}
            onClick={(e) => {
              if (!onOpenPendingEdit) return;
              e.stopPropagation();
              onOpenPendingEdit(node.path, annotation.runIds);
            }}
            onKeyDown={(e) => {
              if (!onOpenPendingEdit) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onOpenPendingEdit(node.path, annotation.runIds);
              }
            }}
            title={
              annotation.count > 1
                ? `${annotation.count} pending edits across ${annotation.runIds.length} run${annotation.runIds.length === 1 ? '' : 's'}`
                : 'Open pending diff'
            }
            style={onOpenPendingEdit ? { cursor: 'pointer' } : undefined}
          >
            {annotation.count > 1 ? `${annotation.count} ${annotation.status}` : annotation.status}
          </span>
        )}
      </button>
    </div>
  );
}
