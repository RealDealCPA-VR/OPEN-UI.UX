import { useEffect, useRef, useState } from 'react';
import { ModelPicker } from './ModelPicker';
import type { ResendStrategy } from '../../shared/provider-switch';
import { useSelectedModel } from '../state/selected-model-context';

interface ProviderSwitchButtonProps {
  conversationId: string | null;
  disabled?: boolean;
  onSwitched?: (args: {
    providerId: string;
    modelId: string;
    resendStrategy: ResendStrategy;
    summary: string | null;
  }) => void;
}

export function ProviderSwitchButton({
  conversationId,
  disabled,
  onSwitched,
}: ProviderSwitchButtonProps): JSX.Element {
  const { selected, selectedCapabilities } = useSelectedModel();
  const [open, setOpen] = useState(false);
  const [resendStrategy, setResendStrategy] = useState<ResendStrategy>('summary-only');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [initialSelection, setInitialSelection] = useState<{
    providerId: string;
    modelId: string;
  } | null>(null);

  const closePanel = (): void => {
    setOpen(false);
    setError(null);
    setInitialSelection(null);
  };

  const togglePanel = (): void => {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    setInitialSelection(
      selected ? { providerId: selected.providerId, modelId: selected.modelId } : null,
    );
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      const root = rootRef.current;
      if (!root) return;
      // composedPath() walks past shadow boundaries and reflects React Portal
      // chains too — covers ModelPicker dropdowns rendered into other parents.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.length > 0 && path.includes(root)) return;
      if (root.contains(e.target as Node)) return;
      setOpen(false);
      setError(null);
      setInitialSelection(null);
    };
    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        setError(null);
        setInitialSelection(null);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  const handleConfirm = async (): Promise<void> => {
    if (!conversationId || !selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await window.opencodex.chat.switchProvider({
        conversationId,
        providerId: selected.providerId,
        modelId: selected.modelId,
        resendStrategy,
      });
      onSwitched?.({
        providerId: res.providerId,
        modelId: res.modelId,
        resendStrategy: res.resendStrategy,
        summary: res.summary,
      });
      closePanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const buttonLabel = selectedCapabilities
    ? `Switch provider — ${selectedCapabilities.displayName}`
    : 'Switch provider';

  const hasChanged =
    open &&
    initialSelection !== null &&
    selected !== null &&
    (initialSelection.providerId !== selected.providerId ||
      initialSelection.modelId !== selected.modelId);

  return (
    <div className="provider-switch" ref={rootRef} data-provider-switch>
      <button
        type="button"
        className="btn"
        onClick={togglePanel}
        disabled={disabled || !conversationId}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Switch the provider/model for this conversation"
      >
        {buttonLabel}
      </button>
      {open ? (
        <div
          className="provider-switch-pop"
          role="dialog"
          aria-label="Switch provider for this conversation"
          style={{
            position: 'absolute',
            zIndex: 'var(--z-popover)' as unknown as number,
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-dropdown)',
            padding: 12,
            minWidth: 320,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 6,
            }}
          >
            Pick a different provider/model
          </div>
          <ModelPicker />
          <label className="toggle" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={resendStrategy === 'summary-only'}
              onChange={(e) =>
                setResendStrategy(e.target.checked ? 'summary-only' : 'full-history')
              }
            />
            Re-send only what the new provider needs (summary)
          </label>
          {error ? (
            <div
              style={{
                marginTop: 8,
                color: 'var(--danger)',
                fontSize: 12,
              }}
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn" onClick={closePanel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void handleConfirm();
              }}
              disabled={submitting || !hasChanged || !selected || !conversationId}
              title={
                !hasChanged
                  ? 'Pick a different provider/model first'
                  : 'Switch and start a new turn'
              }
            >
              {submitting ? 'Switching…' : 'Switch & continue'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
