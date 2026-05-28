import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  kind?: ToastKind;
  duration?: number | null;
  action?: ToastAction;
}

interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  duration: number | null;
  action?: ToastAction;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => string;
  dismiss: (id?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4500;

let toastSeq = 0;
function nextId(): string {
  toastSeq += 1;
  return `toast-${Date.now()}-${toastSeq}`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id?: string) => {
      setToasts((prev) => {
        if (prev.length === 0) return prev;
        if (id === undefined) {
          const last = prev[prev.length - 1];
          if (!last) return prev;
          clearTimer(last.id);
          return prev.slice(0, -1);
        }
        clearTimer(id);
        return prev.filter((t) => t.id !== id);
      });
    },
    [clearTimer],
  );

  const show = useCallback(
    (message: string, options?: ToastOptions): string => {
      const id = nextId();
      const kind = options?.kind ?? 'info';
      const duration = options?.duration === undefined ? DEFAULT_DURATION : options.duration;
      const toast: Toast = {
        id,
        message,
        kind,
        duration,
        ...(options?.action ? { action: options.action } : {}),
      };
      setToasts((prev) => [...prev, toast]);
      if (duration !== null && duration > 0) {
        const handle = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && toasts.length > 0) {
        dismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toasts.length, dismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => '',
      dismiss: () => {},
    };
  }
  return ctx;
}

function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}): JSX.Element | null {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const reduced = prefersReducedMotion();
  return (
    <div
      className={`toast toast-${toast.kind}${reduced ? ' toast-reduced' : ''}`}
      role={toast.kind === 'error' || toast.kind === 'warn' ? 'alert' : 'status'}
    >
      <span className="toast-message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}
