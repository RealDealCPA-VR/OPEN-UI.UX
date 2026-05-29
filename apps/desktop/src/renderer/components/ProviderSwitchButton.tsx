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
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setError(null);
        setInitialSelection(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
    ? `Switch · ${selectedCapabilities.displayName}`
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
            zIndex: 50,
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 8px)',
            boxShadow: 'var(--shadow-dropdown)',
            padding: 12,
            minWidth: 320,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Pick a different provider/model
          </div>
          <ModelPicker />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 10,
              fontSize: 12,
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
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
