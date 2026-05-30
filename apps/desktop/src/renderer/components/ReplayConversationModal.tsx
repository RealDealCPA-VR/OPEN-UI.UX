import { useEffect, useMemo, useState } from 'react';
import type {
  ReplayConversationRequest,
  ReplayProgressEvent,
  ReplayResult,
} from '../../shared/replay';
import { useSelectedModel } from '../state/selected-model-context';

export interface ReplayConversationModalProps {
  conversationId: string;
  onClose: () => void;
}

interface ReplayBridge {
  replayConversation?: (req: ReplayConversationRequest) => Promise<ReplayResult>;
  onProgress?: (listener: (e: ReplayProgressEvent) => void) => () => void;
}

function replayBridge(): ReplayBridge | null {
  const bridge = (window as unknown as { opencodex?: { replay?: ReplayBridge } }).opencodex;
  return bridge?.replay ?? null;
}

export function ReplayConversationModal({
  conversationId,
  onClose,
}: ReplayConversationModalProps): JSX.Element {
  const { configuredProviders, selected } = useSelectedModel();
  const [providerId, setProviderId] = useState<string>(
    selected?.providerId ?? configuredProviders[0]?.info.id ?? '',
  );
  const [modelId, setModelId] = useState<string>(selected?.modelId ?? '');
  const [diffAgainstOriginal, setDiffAgainstOriginal] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReplayProgressEvent | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);

  const provider = useMemo(
    () => configuredProviders.find((p) => p.info.id === providerId) ?? null,
    [configuredProviders, providerId],
  );

  const models = useMemo(() => provider?.info.models ?? [], [provider]);

  useEffect(() => {
    if (modelId !== '' || models.length === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setModelId(models[0]?.id ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [models, modelId]);

  useEffect(() => {
    const bridge = replayBridge();
    if (!bridge?.onProgress) return;
    const off = bridge.onProgress((event) => {
      setProgress(event);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  const runReplay = async (): Promise<void> => {
    const bridge = replayBridge();
    if (!bridge?.replayConversation) {
      setError('Replay bridge unavailable');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const r = await bridge.replayConversation({
        conversationId,
        targetProviderId: providerId,
        targetModelId: modelId,
        diffAgainstOriginal,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const progressPercent =
    progress?.totalMessages && progress.totalMessages > 0 && progress.messageIndex !== undefined
      ? Math.round(((progress.messageIndex + 1) / progress.totalMessages) * 100)
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: 20,
          width: 'min(620px, 90vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <h2 id="replay-modal-title" style={{ marginTop: 0, marginBottom: 12 }}>
          Replay conversation
        </h2>

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Target provider</span>
            <select
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value);
                setModelId('');
              }}
              disabled={busy}
            >
              {configuredProviders.map((p) => (
                <option key={p.info.id} value={p.info.id}>
                  {p.info.displayName}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Target model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={busy || models.length === 0}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={diffAgainstOriginal}
              onChange={(e) => setDiffAgainstOriginal(e.target.checked)}
              disabled={busy}
            />
            <span>Diff replay output against original responses</span>
          </label>

          {error ? (
            <div
              role="alert"
              style={{
                background: 'var(--danger-bg, #fee)',
                border: '1px solid var(--danger-border, #fcc)',
                color: 'var(--danger, #900)',
                borderRadius: 6,
                padding: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          {busy ? (
            <div
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 10,
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {progress?.stage === 'starting'
                  ? 'Starting replay…'
                  : progress?.stage === 'message'
                    ? `Replaying message ${(progress.messageIndex ?? 0) + 1} of ${progress.totalMessages ?? '?'}`
                    : progress?.stage === 'completed'
                      ? 'Finalizing…'
                      : 'Working…'}
              </div>
              {progressPercent !== null ? (
                <div
                  style={{
                    background: 'var(--bg-sunken)',
                    height: 6,
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      background: 'var(--accent)',
                      height: '100%',
                      width: `${progressPercent}%`,
                      transition: 'width 200ms var(--ease)',
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                display: 'grid',
                gap: 8,
                fontSize: 13,
              }}
            >
              <div>
                <strong>{result.messagesReplayed}</strong> messages replayed.{' '}
                <strong>{result.pairs.filter((p) => p.contentChanged).length}</strong> diverged.
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                tokens: {result.totalTokensInput} in / {result.totalTokensOutput} out · cost: $
                {result.totalCostUsd.toFixed(4)}
              </div>
              {result.errors.length > 0 ? (
                <div style={{ color: 'var(--warn)' }}>
                  {result.errors.length} error{result.errors.length === 1 ? '' : 's'}:{' '}
                  {result.errors[0]}
                </div>
              ) : null}
              {diffAgainstOriginal ? (
                <details>
                  <summary style={{ cursor: 'pointer' }}>Diff pairs</summary>
                  <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                    {result.pairs.map((p, idx) => (
                      <li key={p.originalMessageId + idx}>
                        Pair {idx + 1}:{' '}
                        {p.contentChanged ? (
                          <span style={{ color: 'var(--warn)' }}>changed</span>
                        ) : (
                          <span style={{ color: 'var(--success)' }}>identical</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || providerId === '' || modelId === ''}
            onClick={() => void runReplay()}
          >
            {busy ? 'Running…' : result ? 'Run again' : 'Run replay'}
          </button>
        </div>
      </div>
    </div>
  );
}
