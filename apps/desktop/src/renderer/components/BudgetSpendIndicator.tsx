import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BudgetExceededEvent,
  BudgetSpendSummary,
  BudgetWarningEvent,
  GetCurrentSpendRequest,
  GetCurrentSpendResponse,
} from '../../shared/budgets';
import { getBridge } from '../bridge';
import { useChat } from '../state/chat-context';
import { deriveBudgetIndicator } from './budget-spend-derive';

interface BudgetsIndicatorBridge {
  getCurrentSpend(req: GetCurrentSpendRequest): Promise<GetCurrentSpendResponse>;
  onWarning(listener: (payload: BudgetWarningEvent) => void): () => void;
  onExceeded(listener: (payload: BudgetExceededEvent) => void): () => void;
}

function budgetsBridge(): BudgetsIndicatorBridge | null {
  const root = getBridge() as
    | (typeof window.opencodex & { budgets?: BudgetsIndicatorBridge })
    | null;
  return root?.budgets ?? null;
}

const REFRESH_AFTER_EVENT_DELAY_MS = 250;

const TONE_BG: Record<'idle' | 'warn' | 'danger', string> = {
  idle: 'var(--bg-sunken)',
  warn: 'var(--warn-bg)',
  danger: 'var(--danger-bg-deep)',
};

const TONE_BORDER: Record<'idle' | 'warn' | 'danger', string> = {
  idle: 'var(--border)',
  warn: 'var(--warn-border)',
  danger: 'var(--danger-border)',
};

const TONE_FG: Record<'idle' | 'warn' | 'danger', string> = {
  idle: 'var(--text-secondary)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
};

export interface BudgetSpendIndicatorProps {
  conversationId?: string | null;
}

/**
 * Status-bar pill showing the worst-case current budget spend. Listens to
 * `budget:warning` and `budget:exceeded` events to refresh promptly when the
 * chat runner crosses a threshold. The indicator hides itself when no budgets
 * are configured so the status bar stays uncluttered.
 *
 * Pass `conversationId` to scope spend to a specific chat. When omitted the
 * component falls back to the active chat conversation (via ChatContext), so it
 * works wherever the status bar mounts.
 */
export function BudgetSpendIndicator({
  conversationId,
}: BudgetSpendIndicatorProps = {}): JSX.Element | null {
  const { activeId } = useChat();
  const effectiveConvId = conversationId === undefined ? activeId : conversationId;
  const [summaries, setSummaries] = useState<BudgetSpendSummary[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const bridge = useMemo(() => budgetsBridge(), []);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async (): Promise<void> => {
      try {
        const res = await bridge.getCurrentSpend({
          conversationId: effectiveConvId,
          providerId: null,
        });
        if (!cancelled) setSummaries(res.summaries);
      } catch {
        // Status-bar pill is advisory — never block the bar on a load error.
        if (!cancelled) setLoadFailed(true);
      }
    };

    void refresh();

    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void refresh();
      }, REFRESH_AFTER_EVENT_DELAY_MS);
    };

    const offWarning = bridge.onWarning((_payload: BudgetWarningEvent) => {
      scheduleRefresh();
    });
    const offExceeded = bridge.onExceeded((_payload: BudgetExceededEvent) => {
      scheduleRefresh();
    });

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      offWarning();
      offExceeded();
    };
  }, [bridge, effectiveConvId]);

  if (!bridge || loadFailed) return null;
  const state = deriveBudgetIndicator(summaries);
  if (state.primary === null) return null;

  return (
    <Link
      to="/settings/budgets"
      title={`${state.label} — click to manage budgets`}
      className="statusbar-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 'var(--radius-pill)',
        background: TONE_BG[state.tone],
        border: `1px solid ${TONE_BORDER[state.tone]}`,
        color: TONE_FG[state.tone],
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }}
    >
      <span>{state.label}</span>
    </Link>
  );
}

export default BudgetSpendIndicator;
