import { useEffect, useState } from 'react';

export interface CloudProviderTipProps {
  providerId: string;
  providerDisplayName: string;
}

const LOCAL_PROVIDER_IDS = new Set<string>(['ollama']);

export function CloudProviderTip({
  providerId,
  providerDisplayName,
}: CloudProviderTipProps): JSX.Element | null {
  const [shown, setShown] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (LOCAL_PROVIDER_IDS.has(providerId)) {
        setShown(true);
        return;
      }
      void window.opencodex.settings
        .getCloudProviderTipShown()
        .then((value) => {
          if (cancelled) return;
          setShown(value);
        })
        .catch(() => {
          if (!cancelled) setShown(true);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (shown !== false) return null;
  if (LOCAL_PROVIDER_IDS.has(providerId)) return null;

  const dismiss = (): void => {
    setShown(true);
    void window.opencodex.settings.setCloudProviderTipShown(true).catch(() => {
      // best-effort persistence; UI stays dismissed regardless
    });
  };

  return (
    <div
      role="status"
      className="cloud-provider-tip"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--accent-soft-bg)',
        border: '1px solid var(--accent-border)',
        borderRadius: 'var(--radius)',
        color: 'var(--text-primary)',
        lineHeight: 1.4,
      }}
    >
      <span style={{ flex: 1 }}>
        <strong>Cloud provider:</strong> {providerDisplayName} — your prompts and attached files
        leave this machine. Switch to Ollama for fully local runs.
      </span>
      <button
        type="button"
        className="btn btn-compact"
        onClick={dismiss}
        aria-label="Dismiss cloud provider tip"
      >
        Got it
      </button>
    </div>
  );
}
