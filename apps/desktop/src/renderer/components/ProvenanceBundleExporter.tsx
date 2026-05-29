import { useState } from 'react';
import type {
  ExportProvenanceBundleRequest,
  ExportProvenanceBundleResponse,
} from '../../shared/replay';

export interface ProvenanceBundleExporterProps {
  conversationId: string;
  conversationTitle?: string;
}

interface ReplayBridge {
  exportProvenanceBundle?: (
    req: ExportProvenanceBundleRequest,
  ) => Promise<ExportProvenanceBundleResponse>;
}

function replayBridge(): ReplayBridge | null {
  const bridge = (window as unknown as { opencodex?: { replay?: ReplayBridge } }).opencodex;
  return bridge?.replay ?? null;
}

export function ProvenanceBundleExporter({
  conversationId,
  conversationTitle,
}: ProvenanceBundleExporterProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedTo, setLastSavedTo] = useState<string | null>(null);

  const onExport = async (): Promise<void> => {
    const bridge = replayBridge();
    if (!bridge?.exportProvenanceBundle) {
      setError('Replay bridge unavailable');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await bridge.exportProvenanceBundle({ conversationId });
      if (res.savedTo) {
        setLastSavedTo(res.savedTo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>
        Export provenance bundle{conversationTitle ? ` — ${conversationTitle}` : ''}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Bundles the full conversation transcript + every applied diff with prompt + citations +
        routing decisions, as a single JSON file.
      </div>
      <div>
        <button type="button" className="btn" disabled={busy} onClick={() => void onExport()}>
          {busy ? 'Exporting…' : 'Export bundle…'}
        </button>
      </div>
      {error ? (
        <div role="alert" style={{ color: 'var(--danger, #900)', fontSize: 12 }}>
          {error}
        </div>
      ) : null}
      {lastSavedTo ? (
        <div style={{ color: 'var(--success)', fontSize: 12 }}>Saved to {lastSavedTo}</div>
      ) : null}
    </div>
  );
}
