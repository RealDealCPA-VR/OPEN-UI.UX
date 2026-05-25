import { useCallback, useEffect, useState } from 'react';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren: boolean;
}

export type EditAnnotation = 'pending' | 'applied' | 'rejected';

interface FileTreeProps {
  annotations?: Record<string, EditAnnotation>;
  onOpenFile?: (path: string) => void;
}

interface NodeState {
  entries: FileNode[];
  expanded: boolean;
  loading: boolean;
}

export function FileTree({ annotations, onOpenFile }: FileTreeProps): JSX.Element {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [root, setRoot] = useState<NodeState>({ entries: [], expanded: true, loading: true });
  const [children, setChildren] = useState<Record<string, NodeState>>({});

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await window.opencodex.fileTree.list();
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
    return window.opencodex.workspace.onChanged(() => setReloadKey((k) => k + 1));
  }, []);

  const toggle = useCallback(
    async (path: string): Promise<void> => {
      const current = children[path];
      if (current?.expanded) {
        setChildren((prev) => ({ ...prev, [path]: { ...current, expanded: false } }));
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
      const result = await window.opencodex.fileTree.list(path);
      setChildren((prev) => ({
        ...prev,
        [path]: { entries: result.entries, expanded: true, loading: false },
      }));
    },
    [children],
  );

  if (!workspaceRoot) {
    return <p className="settings-section-desc">Pick a workspace in Settings → Workspace.</p>;
  }

  return (
    <div className="file-tree">
      <div className="file-tree-root">{workspaceRoot}</div>
      {root.loading ? (
        <div className="file-tree-loading">Loading…</div>
      ) : (
        <ul className="file-tree-list">
          {root.entries.map((entry) => (
            <FileTreeNodeView
              key={entry.path}
              node={entry}
              depth={0}
              nodeChildren={children}
              onToggle={(path) => void toggle(path)}
              onOpenFile={onOpenFile}
              annotations={annotations}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileTreeNodeView({
  node,
  depth,
  nodeChildren,
  onToggle,
  onOpenFile,
  annotations,
}: {
  node: FileNode;
  depth: number;
  nodeChildren: Record<string, NodeState>;
  onToggle(path: string): void;
  onOpenFile?: (path: string) => void;
  annotations?: Record<string, EditAnnotation>;
}): JSX.Element {
  const childState = nodeChildren[node.path];
  const annotation = annotations?.[node.path];

  const onClick = (): void => {
    if (node.isDirectory) onToggle(node.path);
    else onOpenFile?.(node.path);
  };

  return (
    <li className="file-tree-node">
      <button
        type="button"
        className="file-tree-row"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={onClick}
      >
        <span className="file-tree-icon">
          {node.isDirectory ? (childState?.expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="file-tree-name">{node.name}</span>
        {annotation && (
          <span className={`file-tree-annotation file-tree-annotation-${annotation}`}>
            {annotation}
          </span>
        )}
      </button>
      {node.isDirectory && childState?.expanded && (
        <ul className="file-tree-list">
          {childState.loading ? (
            <li className="file-tree-loading">Loading…</li>
          ) : (
            childState.entries.map((entry) => (
              <FileTreeNodeView
                key={entry.path}
                node={entry}
                depth={depth + 1}
                nodeChildren={nodeChildren}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                annotations={annotations}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
