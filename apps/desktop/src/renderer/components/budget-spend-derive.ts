import type { BudgetSpendSummary } from '../../shared/budgets';

export interface BudgetIndicatorState {
  /** The summary driving the displayed pill, or null when nothing should show. */
  primary: BudgetSpendSummary | null;
  /** Highest ratio among ALL summaries, even ones with non-hard-stop budgets. */
  maxRatio: number;
  tone: 'idle' | 'warn' | 'danger';
  label: string;
}

/**
 * Pick the budget that should drive the always-visible status-bar pill.
 *
 * Priority:
 *   1. Any exceeded hard-stop budget (the one the chat runner will refuse against).
 *   2. The budget with the highest spend ratio overall.
 * Returns idle state when there are no budgets at all so the pill hides itself.
 */
export function deriveBudgetIndicator(
  summaries: readonly BudgetSpendSummary[],
): BudgetIndicatorState {
  if (summaries.length === 0) {
    return { primary: null, maxRatio: 0, tone: 'idle', label: 'No budget' };
  }

  let highest: BudgetSpendSummary | null = null;
  let highestRatio = -1;
  let exceededHardStop: BudgetSpendSummary | null = null;
  for (const s of summaries) {
    if (s.ratio > highestRatio) {
      highest = s;
      highestRatio = s.ratio;
    }
    if (s.exceeded && s.hardStop && exceededHardStop === null) {
      exceededHardStop = s;
    }
  }

  const primary = exceededHardStop ?? highest;
  if (!primary) return { primary: null, maxRatio: 0, tone: 'idle', label: 'No budget' };

  const tone = pickTone(primary);
  return {
    primary,
    maxRatio: Math.max(0, highestRatio),
    tone,
    label: formatLabel(primary),
  };
}

export function pickTone(summary: BudgetSpendSummary): 'idle' | 'warn' | 'danger' {
  if (summary.ratio >= 1) return 'danger';
  if (summary.ratio >= summary.warnThresholdPct / 100) return 'warn';
  // The fixed 90% mark stays as a "danger soon" warn even when threshold is lower.
  if (summary.ratio >= 0.9) return 'warn';
  return 'idle';
}

export function formatLabel(summary: BudgetSpendSummary): string {
  const pct = Math.min(999, Math.round(summary.ratio * 100));
  return `$${summary.spentUsd.toFixed(2)} / $${summary.amountUsd.toFixed(2)} (${pct}%)`;
}
