import { useEffect, useRef, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
  closeOnBackdrop?: boolean;
  initialFocusSelector?: string;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.tabIndex === -1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style =
      typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

const INERT_TARGET_SELECTORS = ['body > #root', 'body > #app'];

function applyInertToSiblings(except: HTMLElement | null): () => void {
  if (typeof document === 'undefined') return () => {};
  const restorers: Array<() => void> = [];
  for (const sel of INERT_TARGET_SELECTORS) {
    const node = document.querySelector<HTMLElement>(sel);
    if (!node || node === except || node.contains(except)) continue;
    const prevAriaHidden = node.getAttribute('aria-hidden');
    const prevInert = node.hasAttribute('inert');
    node.setAttribute('aria-hidden', 'true');
    if (!prevInert) node.setAttribute('inert', '');
    restorers.push(() => {
      if (prevAriaHidden === null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', prevAriaHidden);
      if (!prevInert) node.removeAttribute('inert');
    });
  }
  return () => {
    for (const restore of restorers) restore();
  };
}

export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  className,
  backdropClassName,
  children,
  closeOnBackdrop = true,
  initialFocusSelector,
}: ModalProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const restoreInert = applyInertToSiblings(containerRef.current);

    const focusInitial = (): void => {
      const root = containerRef.current;
      if (!root) return;
      let target: HTMLElement | null = null;
      if (initialFocusSelector) {
        target = root.querySelector<HTMLElement>(initialFocusSelector);
      }
      if (!target) {
        const list = focusableWithin(root);
        target = list[0] ?? root;
      }
      target.focus();
    };
    focusInitial();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const list = focusableWithin(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      restoreInert();
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus();
        } catch {
          // ignore — node may be detached
        }
      }
    };
  }, [open, onClose, initialFocusSelector]);

  if (!open) return null;

  return (
    <div
      className={backdropClassName ?? 'approval-modal-backdrop'}
      role="presentation"
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={className ?? 'approval-modal'}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
