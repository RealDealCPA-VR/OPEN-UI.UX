import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type ContextMenuSection = 'open' | 'edit' | 'share';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  section?: ContextMenuSection;
}

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const SECTION_ORDER: ContextMenuSection[] = ['open', 'edit', 'share'];

function sectionOf(item: ContextMenuItem): ContextMenuSection {
  if (item.section) return item.section;
  // Heuristic fallback for callers that haven't tagged their items.
  const l = item.label.toLowerCase();
  if (l.startsWith('open')) return 'open';
  if (l.startsWith('reveal') || l.startsWith('copy')) return 'share';
  return 'edit';
}

export function FileTreeContextMenu({
  x,
  y,
  items,
  onClose,
}: FileTreeContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x });
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const i = items.findIndex((it) => !it.disabled);
    return i >= 0 ? i : 0;
  });

  const sectioned = useMemo(() => {
    const groups = new Map<ContextMenuSection, ContextMenuItem[]>();
    for (const it of items) {
      const s = sectionOf(it);
      const arr = groups.get(s) ?? [];
      arr.push(it);
      groups.set(s, arr);
    }
    const out: Array<{ section: ContextMenuSection; items: ContextMenuItem[] }> = [];
    for (const s of SECTION_ORDER) {
      const arr = groups.get(s);
      if (arr && arr.length > 0) out.push({ section: s, items: arr });
    }
    return out;
  }, [items]);

  const orderedItems = useMemo<ContextMenuItem[]>(
    () => sectioned.flatMap((g) => g.items),
    [sectioned],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nextLeft = x;
    let nextTop = y;
    if (nextLeft + r.width > vw - 4) nextLeft = Math.max(4, vw - r.width - 4);
    if (nextTop + r.height > vh - 4) nextTop = Math.max(4, vh - r.height - 4);
    setPos((prev) =>
      prev.left === nextLeft && prev.top === nextTop ? prev : { top: nextTop, left: nextLeft },
    );
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => nextEnabledIdx(orderedItems, prev, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => nextEnabledIdx(orderedItems, prev, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = orderedItems[activeIdx];
        if (item && !item.disabled) {
          item.onSelect();
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, orderedItems, activeIdx]);

  useEffect(() => {
    const btn = buttonRefs.current[activeIdx];
    if (btn) btn.focus();
  }, [activeIdx]);

  let runningIdx = 0;
  return (
    <div
      ref={ref}
      className="file-tree-context-menu"
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
    >
      {sectioned.map((group, gi) => {
        const groupNode = (
          <div key={group.section} role="group" aria-label={group.section}>
            {gi > 0 ? (
              <div
                aria-hidden
                style={{
                  height: 1,
                  background: 'var(--border-row-divider)',
                  margin: '4px 6px',
                  opacity: 0.7,
                }}
              />
            ) : null}
            {group.items.map((item) => {
              const idx = runningIdx++;
              return (
                <button
                  key={`${group.section}:${item.label}`}
                  ref={(el) => {
                    buttonRefs.current[idx] = el;
                  }}
                  type="button"
                  role="menuitem"
                  className="file-tree-context-menu-item"
                  disabled={item.disabled ?? false}
                  data-active={idx === activeIdx ? 'true' : undefined}
                  style={idx === activeIdx ? { background: 'var(--bg-row-hover)' } : undefined}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    item.onSelect();
                    onClose();
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        );
        return groupNode;
      })}
    </div>
  );
}

function nextEnabledIdx(items: ContextMenuItem[], current: number, step: number): number {
  if (items.length === 0) return 0;
  let i = current;
  for (let n = 0; n < items.length; n++) {
    i = (i + step + items.length) % items.length;
    if (!items[i]?.disabled) return i;
  }
  return current;
}
