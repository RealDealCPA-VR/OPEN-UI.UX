import { describe, expect, it } from 'vitest';
import type { BudgetSpendSummary } from '../../shared/budgets';
import { deriveBudgetIndicator, formatLabel, pickTone } from './budget-spend-derive';

function summary(partial: Partial<BudgetSpendSummary> = {}): BudgetSpendSummary {
  return {
    budgetId: 'b1',
    scope: 'global',
    scopeId: null,
    period: 'day',
    amountUsd: 10,
    spentUsd: 0,
    ratio: 0,
    warnThresholdPct: 80,
    hardStop: true,
    periodKey: '2026-05-28',
    exceeded: false,
    warning: false,
    ...partial,
  };
}

describe('deriveBudgetIndicator', () => {
  it('returns idle and no primary when there are no budgets', () => {
    const state = deriveBudgetIndicator([]);
    expect(state.primary).toBeNull();
    expect(state.tone).toBe('idle');
  });

  it('chooses the budget with the highest ratio when none are exceeded', () => {
    const low = summary({ budgetId: 'low', spentUsd: 2, ratio: 0.2 });
    const high = summary({ budgetId: 'high', spentUsd: 7, ratio: 0.7 });
    const state = deriveBudgetIndicator([low, high]);
    expect(state.primary?.budgetId).toBe('high');
  });

  it('prefers an exceeded hard-stop budget over a higher-ratio warn-only one', () => {
    const warnOnlyHigher = summary({
      budgetId: 'warn',
      spentUsd: 12,
      ratio: 1.2,
      hardStop: false,
      exceeded: true,
    });
    const hardStop = summary({
      budgetId: 'hard',
      spentUsd: 10,
      ratio: 1.0,
      hardStop: true,
      exceeded: true,
    });
    const state = deriveBudgetIndicator([warnOnlyHigher, hardStop]);
    expect(state.primary?.budgetId).toBe('hard');
    expect(state.tone).toBe('danger');
  });
});

describe('pickTone', () => {
  it('returns idle below the warn threshold', () => {
    expect(pickTone(summary({ ratio: 0.5, warnThresholdPct: 80 }))).toBe('idle');
  });

  it('returns warn at the configured threshold', () => {
    expect(pickTone(summary({ ratio: 0.8, warnThresholdPct: 80 }))).toBe('warn');
  });

  it('returns warn at the fixed 90% mark even when threshold is higher', () => {
    expect(pickTone(summary({ ratio: 0.9, warnThresholdPct: 95 }))).toBe('warn');
  });

  it('returns danger at 100% and above', () => {
    expect(pickTone(summary({ ratio: 1 }))).toBe('danger');
    expect(pickTone(summary({ ratio: 2 }))).toBe('danger');
  });
});

describe('formatLabel', () => {
  it('renders dollars and percentage', () => {
    const label = formatLabel(summary({ spentUsd: 2.5, amountUsd: 10, ratio: 0.25 }));
    expect(label).toBe('$2.50 / $10.00 (25%)');
  });

  it('caps displayed percentage at 999', () => {
    const label = formatLabel(summary({ spentUsd: 9999, amountUsd: 1, ratio: 9999 }));
    expect(label).toContain('(999%)');
  });
});
