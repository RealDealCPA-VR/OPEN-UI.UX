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
        borderRadius: 8,
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Provider</span>
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Model</span>
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
        </label>
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

      {result && !error ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>
            Replay output ({result.tokensInput} in / {result.tokensOutput} out, $
            {result.costUsd.toFixed(4)})
          </summary>
          <pre
            style={{
              background: 'var(--bg-sunken)',
              padding: 8,
              borderRadius: 4,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 240,
              marginTop: 8,
            }}
          >
            {result.replayContent}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
