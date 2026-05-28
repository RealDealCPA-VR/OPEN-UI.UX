import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CodebasePreviewPane } from '../components/CodebasePreviewPane';
import { CodebaseSearchBox } from '../components/CodebaseSearchBox';
import { FileTree } from '../components/FileTree';
import { FileTreeContextMenu, type ContextMenuItem } from '../components/FileTreeContextMenu';
import { useAgentPendingEdits } from '../hooks/use-agent-pending-edits';
import { consumeTransfer, onTransferPushed, pushTransfer } from '../state/transfer';
import { annotationMapFromPending } from './codebase-pending-edits-derive';

interface ContextMenuState {
  path: string;
  isDirectory: boolean;
  x: number;
  y: number;
}

const RECENT_FILES_KEY = 'opencodex.codebase.recent-files';
const RECENT_FILES_MAX = 10;

function pushRecentFile(path: string): void {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_FILES_MAX);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable; recents is best-effort.
  }
}

export function CodebaseView(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [jumpToLine, setJumpToLine] = useState<number | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  const pendingEdits = useAgentPendingEdits();
  const workspaceRootRef = useRef<string | null>(workspaceRoot);
  useEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    void window.opencodex.workspace
      .get()
      .then((s) => {
        if (!cancelled) setWorkspaceRoot(s.active);
      })
      .catch(() => undefined);
    const off = window.opencodex.workspace.onChanged((payload) => {
      if (!cancelled) setWorkspaceRoot(payload.state.active);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Handle inbound chat-to-codebase transfers.
  useEffect(() => {
    return onTransferPushed((ctx) => {
      if (ctx.kind !== 'chat-to-codebase') return;
      consumeTransfer();
      setPinnedPaths(ctx.filePaths);
      if (ctx.workspaceRoot && ctx.workspaceRoot !== workspaceRootRef.current) {
        void window.opencodex.workspace
          .setActive({ path: ctx.workspaceRoot })
          .catch(() => undefined);
      }
      if (ctx.filePaths[0]) {
        setSelectedPath(ctx.filePaths[0]);
        setJumpToLine(null);
      }
    });
  }, []);

  const annotations = useMemo(
    () => annotationMapFromPending(pendingEdits.entries),
    [pendingEdits.entries],
  );

  const handleOpenFile = useCallback((path: string) => {
    setSelectedPath(path);
    setJumpToLine(null);
    pushRecentFile(path);
  }, []);

  // Honor ?file= deep link from left-column recents.
  useEffect(() => {
    const f = searchParams.get('file');
    if (!f) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPath(f);

    setJumpToLine(null);
    const next = new URLSearchParams(searchParams);
    next.delete('file');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleOpenPendingEdit = useCallback(
    (path: string, runIds: string[]) => {
      pushTransfer({ kind: 'codebase-to-agent', filePath: path, runIds });
      navigate('/agent');
    },
    [navigate],
  );

  const handleContextMenu = useCallback(
    (path: string, isDirectory: boolean, x: number, y: number) => {
      setMenu({ path, isDirectory, x, y });
    },
    [],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const path = menu.path;
    return [
      {
        label: 'Open in preview',
        section: 'open',
        disabled: menu.isDirectory,
        onSelect: () => {
          if (!menu.isDirectory) handleOpenFile(path);
        },
      },
      {
        label: 'Ask agent about this file',
        section: 'edit',
        disabled: menu.isDirectory,
        onSelect: () => {
          pushTransfer({ kind: 'codebase-to-chat', filePath: path });
          navigate('/chat');
        },
      },
      {
        label: 'Copy path',
        section: 'edit',
        onSelect: () => {
          void navigator.clipboard.writeText(path).catch(() => undefined);
        },
      },
      {
        label: 'Reveal in OS',
        section: 'share',
        onSelect: () => {
          if (!workspaceRoot) return;
          void window.opencodex.shell.showItemInFolder(workspaceRoot, path).catch(() => undefined);
        },
      },
    ];
  }, [menu, workspaceRoot, handleOpenFile, navigate]);

  const continueInChat = useCallback(() => {
    if (!selectedPath) return;
    pushTransfer({ kind: 'codebase-to-chat', filePath: selectedPath });
    navigate('/chat');
  }, [selectedPath, navigate]);

  return (
    <section className="view codebase-view">
      <header className="codebase-head">
        <h1>Codebase</h1>
        <p>Workspace file tree. Click a file to preview; pending agent edits show pills.</p>
      </header>
      <div className="codebase-search-wrap">
        <CodebaseSearchBox
          workspaceRoot={workspaceRoot}
          onPick={(hit) => {
            setSelectedPath(hit.path);
            setJumpToLine(hit.line ?? null);
          }}
          pinnedPaths={pinnedPaths}
          onClearPinned={() => setPinnedPaths([])}
        />
      </div>
      <div className="codebase-body">
        <aside className="codebase-tree-pane">
          <FileTree
            annotations={annotations}
            onOpenFile={handleOpenFile}
            onContextMenu={handleContextMenu}
            onOpenPendingEdit={handleOpenPendingEdit}
          />
        </aside>
        <div className="codebase-preview-wrap">
          {selectedPath && (
            <div className="codebase-preview-actions">
              <button type="button" className="btn" onClick={continueInChat}>
                Continue in chat
              </button>
            </div>
          )}
          <CodebasePreviewPane
            workspaceRoot={workspaceRoot}
            path={selectedPath}
            jumpToLine={jumpToLine}
          />
        </div>
      </div>
      {menu && <FileTreeContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </section>
  );
}
