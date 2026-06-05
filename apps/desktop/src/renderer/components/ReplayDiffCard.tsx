import { useState } from 'react';
import type { AppliedDiff, ReplayDiffRequest, ReplayDiffResult } from '../../shared/replay';
import { useSelectedModel } from '../state/selected-model-context';

export interface ReplayDiffCardProps {
  appliedDiff: AppliedDiff;
}

interface ReplayBridge {
  replayDiff?: (req: ReplayDiffRequest) => Promise<ReplayDiffResult>;
}

function replayBridge(): ReplayBridge | null {
  const bridge = (window as unknown as { opencodex?: { replay?: ReplayBridge } }).opencodex;
  return bridge?.replay ?? null;
}

export function ReplayDiffCard({ appliedDiff }: ReplayDiffCardProps): JSX.Element {
  const { configuredProviders, selected } = useSelectedModel();
  const [providerId, setProviderId] = useState<string>(
    selected?.providerId ?? configuredProviders[0]?.info.id ?? '',
  );
  const [modelId, setModelId] = useState<string>(selected?.modelId ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplayDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = configuredProviders.find((p) => p.info.id === providerId) ?? null;
  const models = provider?.info.models ?? [];

  const runReplay = async (): Promise<void> => {
    const bridge = replayBridge();
    if (!bridge?.replayDiff) {
      setError('Replay bridge unavailable');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await bridge.replayDiff({
        appliedDiffId: appliedDiff.id,
        targetProviderId: providerId,
        targetModelId: modelId,
      });
      setResult(r);
      if (r.error) setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{appliedDiff.filePath}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            originally {appliedDiff.providerId ?? '?'} · {appliedDiff.modelId ?? '?'} ·{' '}
            {new Date(appliedDiff.appliedAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field">
          <label className="field-label">Provider</label>
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
        </div>
        <div className="field">
          <label className="field-label">Model</label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={busy || models.length === 0}
          >
            <option value="">—</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || providerId === '' || modelId === ''}
          onClick={() => void runReplay()}
        >
          {busy ? 'Replaying…' : 'Replay diff'}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            color: 'var(--danger)',
            borderRadius: 'var(--radius-sm)',
            padding: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {result && !error ? (
        <details
          style={{
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13,
              padding: '6px 10px',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--text-secondary)',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderTop: '1.5px solid var(--text-muted)',
                borderRight: '1.5px solid var(--text-muted)',
                transform: 'rotate(45deg)',
                flexShrink: 0,
                transition: 'transform var(--duration) var(--ease)',
              }}
            />
            Replay output ({result.tokensInput} in / {result.tokensOutput} out, $
            {result.costUsd.toFixed(4)})
          </summary>
          <pre
            style={{
              background: 'var(--bg-sunken)',
              padding: 8,
              borderRadius: 'var(--radius-2xs)',
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 240,
              margin: '0 8px 8px',
            }}
          >
            {result.replayContent}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
