import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function FileTreeContextMenu({
  x,
  y,
  items,
  onClose,
}: FileTreeContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="file-tree-context-menu"
      role="menu"
      style={{ position: 'fixed', top: y, left: x, zIndex: 1000 }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          role="menuitem"
          className="file-tree-context-menu-item"
          disabled={item.disabled ?? false}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
