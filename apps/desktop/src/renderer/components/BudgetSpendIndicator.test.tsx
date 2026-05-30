// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BudgetSpendSummary, GetCurrentSpendResponse } from '../../shared/budgets';

vi.mock('../state/chat-context', () => ({
  useChat: (): { activeId: string | null } => ({ activeId: 'conv-1' }),
}));

import { BudgetSpendIndicator } from './BudgetSpendIndicator';

type WarningListener = (payload: unknown) => void;
type ExceededListener = (payload: unknown) => void;

interface MockBridge {
  budgets: {
    getCurrentSpend: Mock;
    list: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
    onWarning: Mock;
    onExceeded: Mock;
  };
}

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

function installBridge(initial: BudgetSpendSummary[]): {
  bridge: MockBridge;
  emitWarning: (payload?: unknown) => void;
  emitExceeded: (payload?: unknown) => void;
  setSpend: (next: BudgetSpendSummary[]) => void;
} {
  let current = initial;
  let warningListener: WarningListener | null = null;
  let exceededListener: ExceededListener | null = null;

  const bridge: MockBridge = {
    budgets: {
      getCurrentSpend: vi.fn(
        (): Promise<GetCurrentSpendResponse> => Promise.resolve({ summaries: current }),
      ),
      list: vi.fn(() => Promise.resolve([])),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      onWarning: vi.fn((listener: WarningListener) => {
        warningListener = listener;
        return () => {
          if (warningListener === listener) warningListener = null;
        };
      }),
      onExceeded: vi.fn((listener: ExceededListener) => {
        exceededListener = listener;
        return () => {
          if (exceededListener === listener) exceededListener = null;
        };
      }),
    },
  };

  (window as unknown as { opencodex: MockBridge }).opencodex = bridge;

  return {
    bridge,
    emitWarning: (payload?: unknown): void => {
      warningListener?.(payload ?? {});
    },
    emitExceeded: (payload?: unknown): void => {
      exceededListener?.(payload ?? {});
    },
    setSpend: (next: BudgetSpendSummary[]): void => {
      current = next;
    },
  };
}

describe('BudgetSpendIndicator', () => {
  beforeEach(() => {
    // Scope fake timers to setTimeout/clearTimeout only so RTL's `waitFor`
    // (which polls via real `setInterval` and times itself with real `Date`)
    // doesn't deadlock against frozen wall-clock time. Mirrors the spirit of
    // the runner-probe.test.ts fix from Phase 15.1.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  it('renders nothing when no budgets are configured', async () => {
    installBridge([]);
    const { container } = render(
      <MemoryRouter>
        <BudgetSpendIndicator />
      </MemoryRouter>,
    );
    await vi.runAllTimersAsync();
    expect(container.firstChild).toBeNull();
  });

  it('renders the worst-case summary as a pill link to /settings/budgets', async () => {
    installBridge([
      summary({ spentUsd: 3, ratio: 0.3 }),
      summary({ budgetId: 'b2', spentUsd: 9, ratio: 0.9 }),
    ]);
    render(
      <MemoryRouter>
        <BudgetSpendIndicator />
      </MemoryRouter>,
    );
    // runAllTimersAsync flushes the pending refresh() microtask + the setState
    // that follows it; with setTimeout faked, `waitFor` would deadlock on its
    // own polling step, so assert synchronously instead.
    await vi.runAllTimersAsync();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/settings/budgets');
    expect(link.textContent).toContain('$9.00');
  });

  it('refreshes when budget:warning is emitted', async () => {
    const harness = installBridge([summary({ spentUsd: 1, ratio: 0.1 })]);
    render(
      <MemoryRouter>
        <BudgetSpendIndicator />
      </MemoryRouter>,
    );
    await vi.runAllTimersAsync();
    expect(harness.bridge.budgets.getCurrentSpend).toHaveBeenCalledTimes(1);
    harness.setSpend([summary({ spentUsd: 9, ratio: 0.9 })]);
    harness.emitWarning({
      budgetId: 'b1',
      scope: 'global',
      scopeId: null,
      period: 'day',
      spentUsd: 9,
      amountUsd: 10,
      ratio: 0.9,
      warnThresholdPct: 80,
    });
    await vi.runAllTimersAsync();
    expect(harness.bridge.budgets.getCurrentSpend).toHaveBeenCalledTimes(2);
  });

  it('hides itself if getCurrentSpend rejects', async () => {
    const harness = installBridge([]);
    harness.bridge.budgets.getCurrentSpend.mockImplementation(() =>
      Promise.reject(new Error('boom')),
    );
    const { container } = render(
      <MemoryRouter>
        <BudgetSpendIndicator />
      </MemoryRouter>,
    );
    await vi.runAllTimersAsync();
    expect(container.firstChild).toBeNull();
  });
});
