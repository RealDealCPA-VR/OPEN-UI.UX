import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface HoverHintProps {
  children: ReactElement;
  hint?: string;
  shortcut?: string;
  placement?: Placement;
  disabled?: boolean;
}

// --- enabled context ---------------------------------------------------------
// Default is "on" so a HoverHint dropped anywhere still works without the
// provider being wired into the App tree (that's a later wave).
const HoverHintEnabledContext = createContext<boolean>(true);

export function HoverHintProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <HoverHintEnabledContext.Provider value={enabled}>{children}</HoverHintEnabledContext.Provider>
  );
}

export function useHoverHintsEnabled(): boolean {
  return useContext(HoverHintEnabledContext);
}

// --- suppression context (modals/menus push to hide all hints) ---------------
interface HoverHintSuppressValue {
  suppressed: boolean;
  pushSuppression: () => void;
  popSuppression: () => void;
}

const noopSuppress: HoverHintSuppressValue = {
  suppressed: false,
  pushSuppression: () => {},
  popSuppression: () => {},
};

const HoverHintSuppressContext = createContext<HoverHintSuppressValue>(noopSuppress);

export function HoverHintSuppressProvider({ children }: { children: ReactNode }): JSX.Element {
  const [depth, setDepth] = useState(0);
  const value = useMemo<HoverHintSuppressValue>(
    () => ({
      suppressed: depth > 0,
      pushSuppression: () => setDepth((d) => d + 1),
      popSuppression: () => setDepth((d) => Math.max(0, d - 1)),
    }),
    [depth],
  );
  return (
    <HoverHintSuppressContext.Provider value={value}>{children}</HoverHintSuppressContext.Provider>
  );
}

export function useHoverHintsSuppressed(): boolean {
  return useContext(HoverHintSuppressContext).suppressed;
}

export function useHoverHintControl(): Pick<
  HoverHintSuppressValue,
  'pushSuppression' | 'popSuppression'
> {
  const { pushSuppression, popSuppression } = useContext(HoverHintSuppressContext);
  return { pushSuppression, popSuppression };
}

// --- boundary context (prevents nested HoverHints) ---------------------------
const HoverHintBoundary = createContext<boolean>(false);

// --- dev warning bookkeeping (warn-once per unique hint) ---------------------
const warnedHints = new Set<string>();
const isDev = process.env.NODE_ENV !== 'production';

function capHintWords(hint: string): string {
  const words = hint.trim().split(/\s+/);
  if (words.length <= 5) return hint;
  if (isDev && !warnedHints.has(hint)) {
    warnedHints.add(hint);
    console.warn(`HoverHint: hint exceeds 5 words: "${hint}"`);
  }
  if (isDev) return words.slice(0, 5).join(' ');
  return hint;
}

interface ParsedHint {
  text: string;
  shortcut: string | null;
}

function parseHintAndShortcut(hint: string, explicitShortcut?: string): ParsedHint {
  if (explicitShortcut && explicitShortcut.length > 0) {
    return { text: hint, shortcut: explicitShortcut };
  }
  const idx = hint.lastIndexOf('·');
  if (idx === -1) return { text: hint, shortcut: null };
  const left = hint.slice(0, idx).trim();
  const right = hint.slice(idx + 1).trim();
  if (left.length === 0 || right.length === 0) return { text: hint, shortcut: null };
  return { text: left, shortcut: right };
}

// --- tiny in-house positioner ------------------------------------------------
const GAP = 6;

interface Coords {
  top: number;
  left: number;
  placement: Placement;
}

function computeCoords(
  anchor: DOMRect,
  bubble: { width: number; height: number },
  preferred: Placement,
  viewport: { width: number; height: number },
): Coords {
  const fits = (p: Placement): boolean => {
    if (p === 'top') return anchor.top - bubble.height - GAP >= 0;
    if (p === 'bottom') return anchor.bottom + bubble.height + GAP <= viewport.height;
    if (p === 'left') return anchor.left - bubble.width - GAP >= 0;
    return anchor.right + bubble.width + GAP <= viewport.width;
  };
  const opposite: Record<Placement, Placement> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const placement: Placement = fits(preferred) ? preferred : opposite[preferred];

  let top = 0;
  let left = 0;
  if (placement === 'top') {
    top = anchor.top - bubble.height - GAP;
    left = anchor.left + anchor.width / 2 - bubble.width / 2;
  } else if (placement === 'bottom') {
    top = anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - bubble.width / 2;
  } else if (placement === 'left') {
    top = anchor.top + anchor.height / 2 - bubble.height / 2;
    left = anchor.left - bubble.width - GAP;
  } else {
    top = anchor.top + anchor.height / 2 - bubble.height / 2;
    left = anchor.right + GAP;
  }

  // Clamp into viewport so the bubble never sits half-off-screen.
  left = Math.max(4, Math.min(left, viewport.width - bubble.width - 4));
  top = Math.max(4, Math.min(top, viewport.height - bubble.height - 4));
  return { top, left, placement };
}

// --- main component ---------------------------------------------------------
export function HoverHint(props: HoverHintProps): JSX.Element {
  const { children, hint, shortcut, placement = 'top', disabled = false } = props;

  const enabled = useHoverHintsEnabled();
  const suppressed = useHoverHintsSuppressed();
  const insideBubble = useContext(HoverHintBoundary);

  const bubbleId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const setAnchorRef = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
  }, []);
  const setBubbleRef = useCallback((node: HTMLDivElement | null) => {
    bubbleRef.current = node;
  }, []);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  // Resolve hint text: prefer explicit prop, fall back to child's aria-label.
  const resolvedHint = useMemo(() => {
    if (typeof hint === 'string' && hint.length > 0) return hint;
    if (isValidElement(children)) {
      const ariaLabel = (children.props as { 'aria-label'?: unknown })['aria-label'];
      if (typeof ariaLabel === 'string' && ariaLabel.length > 0) return ariaLabel;
    }
    return undefined;
  }, [hint, children]);

  const parsed = useMemo<ParsedHint | null>(() => {
    if (!resolvedHint) return null;
    return parseHintAndShortcut(resolvedHint, shortcut);
  }, [resolvedHint, shortcut]);

  const cappedHint = useMemo(() => (parsed ? capHintWords(parsed.text) : undefined), [parsed]);

  const shortcutLabel = parsed?.shortcut ?? null;

  // Nested-HoverHint guard. Warn once per mount and bail out at render time.
  useEffect(() => {
    if (insideBubble && isDev) {
      console.warn('HoverHint: nested HoverHints are not allowed; rendering children verbatim.');
    }
  }, [insideBubble]);

  const shouldSkip = disabled || !enabled || !cappedHint || insideBubble || suppressed;

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(
    (instant: boolean) => {
      clearTimers();
      if (instant) {
        setOpen(true);
        return;
      }
      openTimer.current = window.setTimeout(() => {
        setOpen(true);
      }, 300);
    },
    [clearTimers],
  );

  const scheduleClose = useCallback(
    (instant: boolean) => {
      clearTimers();
      if (instant) {
        setOpen(false);
        return;
      }
      closeTimer.current = window.setTimeout(() => {
        setOpen(false);
      }, 100);
    },
    [clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  // Recompute position once the bubble has measurable dimensions.
  useLayoutEffect(() => {
    if (!open || suppressed) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const aRect = anchor.getBoundingClientRect();
    const bRect = bubble.getBoundingClientRect();
    setCoords(
      computeCoords(aRect, { width: bRect.width, height: bRect.height }, placement, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [open, suppressed, placement, cappedHint]);

  // Suppressed mid-open (e.g. modal pops up): hide the bubble via derived render-time gate.
  // We deliberately leave `open` alone — the next blur/mouseleave (or unmount) clears it.
  const isOpen = open && !suppressed;

  // Listener handlers — only attached when we actually render hint behavior.
  const onMouseEnter = useCallback(() => scheduleOpen(false), [scheduleOpen]);
  const onMouseLeave = useCallback(() => scheduleClose(false), [scheduleClose]);
  const onFocus = useCallback(() => scheduleOpen(true), [scheduleOpen]);
  const onBlur = useCallback(() => scheduleClose(true), [scheduleClose]);
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') scheduleClose(true);
    },
    [scheduleClose],
  );

  if (shouldSkip || !isValidElement(children)) {
    return <>{children}</>;
  }

  type AnchorProps = {
    ref?: (node: HTMLElement | null) => void;
    onMouseEnter?: (e: MouseEvent) => void;
    onMouseLeave?: (e: MouseEvent) => void;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    'aria-describedby'?: string;
  };
  const childProps = children.props as AnchorProps & Record<string, unknown>;
  const childAriaDescribedBy = childProps['aria-describedby'];

  // The react-hooks/refs rule flags this because the handlers close over refs
  // (openTimer/closeTimer/anchorRef). They're invoked only as DOM events, never
  // during render — the cloneElement injection is intentional and correct.
  // eslint-disable-next-line react-hooks/refs
  const cloned = cloneElement(children, {
    ref: setAnchorRef,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onKeyDown,
    'aria-describedby': childAriaDescribedBy ? `${childAriaDescribedBy} ${bubbleId}` : bubbleId,
  } as Partial<AnchorProps>);

  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const bubbleStyle: CSSProperties = {
    position: 'fixed',
    top: coords?.top ?? -9999,
    left: coords?.left ?? -9999,
    zIndex: 9999,
    pointerEvents: 'none',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 8px',
    fontSize: 12,
    lineHeight: 1.3,
    maxWidth: 260,
    whiteSpace: 'normal',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
    opacity: coords && isOpen ? 1 : 0,
    transition: reducedMotion ? 'none' : 'opacity 120ms ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const kbdStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    padding: '1px 5px',
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--kbd-bg, var(--bg-sunken))',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  };

  const bubble =
    isOpen && typeof document !== 'undefined'
      ? createPortal(
          <HoverHintBoundary.Provider value={true}>
            <div
              ref={setBubbleRef}
              id={bubbleId}
              role="tooltip"
              data-placement={coords?.placement ?? placement}
              style={bubbleStyle}
            >
              <span>{cappedHint}</span>
              {shortcutLabel ? <kbd style={kbdStyle}>{shortcutLabel}</kbd> : null}
            </div>
          </HoverHintBoundary.Provider>,
          document.body,
        )
      : null;

  return (
    <>
      {cloned}
      {bubble}
    </>
  );
}

export default HoverHint;
