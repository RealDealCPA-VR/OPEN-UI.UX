import { useEffect, useState } from 'react';
import type { EstimateCostsAcrossProvidersResponse } from '../../shared/provider-switch';

interface CostComparisonTooltipProps {
  conversationId: string | null;
  open: boolean;
}

function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function CostComparisonTooltip({
  conversationId,
  open,
}: CostComparisonTooltipProps): JSX.Element | null {
  const [data, setData] = useState<EstimateCostsAcrossProvidersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!open || !conversationId) {
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      void window.opencodex.chat
        .estimateCostsAcrossProviders({ conversationId })
        .then((res) => {
          if (cancelled) return;
          setData(res);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  if (!open) return null;

  return (
    <div
      className="cost-comparison-tooltip"
      role="tooltip"
      style={{
        position: 'absolute',
        zIndex: 'var(--z-popover)' as unknown as number,
        marginTop: 4,
        right: 0,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-dropdown)',
        padding: 10,
        minWidth: 260,
        maxWidth: 360,
        fontSize: 12,
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
        Estimated cost for this conversation
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Calculating…</div>
      ) : error ? (
        <div style={{ color: 'var(--danger)' }}>{error}</div>
      ) : !data || data.estimates.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>No configured providers with pricing.</div>
      ) : (
        <>
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 11,
              marginBottom: 6,
            }}
          >
            {data.totalInputTokens.toLocaleString()} in · {data.totalOutputTokens.toLocaleString()}{' '}
            out
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {data.estimates.map((e) => (
              <li
                key={`${e.providerId}:${e.modelId}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 8,
                  padding: '3px 0',
                  borderBottom: '1px solid var(--border-row-divider, transparent)',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ color: 'var(--text-primary)' }}>{e.modelName}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{e.providerName}</span>
                </span>
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: e.knownPricing ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {e.knownPricing ? formatUsd(e.estimatedCostUsd) : 'no pricing'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
