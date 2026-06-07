import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppliedDiff, ListAppliedDiffsResponse } from '../../shared/replay';
import { ReplayDiffCard } from '../components/ReplayDiffCard';
import { ProvenanceBundleExporter } from '../components/ProvenanceBundleExporter';

interface ReplayBridge {
  listAppliedDiffs?: (req: {
    limit?: number;
    offset?: number;
  }) => Promise<ListAppliedDiffsResponse>;
}

function replayBridge(): ReplayBridge | null {
  const bridge = (window as unknown as { opencodex?: { replay?: ReplayBridge } }).opencodex;
  return bridge?.replay ?? null;
}

const PAGE_SIZE = 100;

export function ReplayPanel(): JSX.Element {
  const [rows, setRows] = useState<AppliedDiff[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const bridge = replayBridge();
    if (!bridge?.listAppliedDiffs) {
      setError('Replay bridge unavailable');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await bridge.listAppliedDiffs({ limit: PAGE_SIZE });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bridge = replayBridge();
      if (!bridge?.listAppliedDiffs) {
        if (!cancelled) {
          setError('Replay bridge unavailable');
          setLoading(false);
        }
        return;
      }
      try {
        const res = await bridge.listAppliedDiffs({ limit: PAGE_SIZE });
        if (!cancelled) {
          setRows(res.rows);
          setTotal(res.total);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One provenance exporter per distinct conversation, in first-seen order.
  const conversations = useMemo(() => {
    const seen = new Map<string, { id: string; title: string }>();
    for (const row of rows) {
      if (!seen.has(row.conversationId)) {
        seen.set(row.conversationId, {
          id: row.conversationId,
          title: row.filePath,
        });
      }
    }
    return Array.from(seen.values());
  }, [rows]);

  if (loading) {
    return (
      <div className="audit-empty-state">
        <span className="mcp-inline-spinner" aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="field-errors">
        {error}{' '}
        <button type="button" className="btn" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="audit-empty-state">
        <p className="settings-block-hint">No applied diffs yet.</p>
        <p className="settings-block-hint">
          When the agent edits or writes a file, the change is recorded here with its prompt,
          citations, and routing decision — so you can replay it against a different model or export
          a signed provenance bundle.
        </p>
      </div>
    );
  }

  return (
    <div className="replay-panel">
      <div className="settings-block">
        <p className="settings-block-hint">
          {rows.length} of {total} applied diff{total === 1 ? '' : 's'}
          {' · '}
          {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <h3 className="settings-subhead">Export provenance bundles</h3>
        {conversations.map((c) => (
          <ProvenanceBundleExporter key={c.id} conversationId={c.id} conversationTitle={c.title} />
        ))}
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <h3 className="settings-subhead">Replay an applied diff</h3>
        {rows.map((d) => (
          <ReplayDiffCard key={d.id} appliedDiff={d} />
        ))}
      </div>
    </div>
  );
}
