// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Budget, CreateBudgetRequest } from '../../shared/budgets';

vi.mock('../state/chat-context', () => ({
  useChat: (): { activeId: string | null } => ({ activeId: 'conv-1' }),
}));

import { ChatBudgetOverride } from './ChatBudgetOverride';

interface MockBudgets {
  list: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
  getCurrentSpend: Mock;
  onWarning: Mock;
  onExceeded: Mock;
}

function installBridge(initial: Budget[] = []): MockBudgets {
  const mock: MockBudgets = {
    list: vi.fn(() => Promise.resolve(initial)),
    create: vi.fn((req: CreateBudgetRequest) =>
      Promise.resolve({
        id: 'budget-new',
        scope: req.scope,
        scopeId: req.scopeId ?? null,
        period: req.period,
        amountUsd: req.amountUsd,
        warnThresholdPct: req.warnThresholdPct ?? 80,
        hardStop: req.hardStop ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ),
    update: vi.fn(() => Promise.resolve({}) as Promise<Budget>),
    delete: vi.fn(() => Promise.resolve({ ok: true })),
    getCurrentSpend: vi.fn(() => Promise.resolve({ summaries: [] })),
    onWarning: vi.fn(() => () => {}),
    onExceeded: vi.fn(() => () => {}),
  };
  (window as unknown as { opencodex: { budgets: MockBudgets } }).opencodex = { budgets: mock };
  return mock;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

function renderInRouter(ui: JSX.Element): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ChatBudgetOverride', () => {
  it('hides itself when no conversation is selected', () => {
    installBridge();
    const { container } = renderInRouter(<ChatBudgetOverride conversationId={null} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows "Set budget" when no override exists and opens the form on click', () => {
    installBridge();
    renderInRouter(<ChatBudgetOverride conversationId="conv-1" />);
    const btn = screen.getByRole('button', { name: /set budget/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('chat-budget-override-popover')).toBeTruthy();
    expect(screen.getByLabelText('Max spend USD')).toBeTruthy();
  });

  it('calls budgets:create with conversation scope when Set is pressed', async () => {
    const bridge = installBridge();
    renderInRouter(<ChatBudgetOverride conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: /set budget/i }));

    const amount = screen.getByLabelText('Max spend USD') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '12.50' } });

    fireEvent.click(screen.getByRole('button', { name: /^set$/i }));

    await waitFor(() => expect(bridge.create).toHaveBeenCalledTimes(1));
    const req = bridge.create.mock.calls[0]?.[0] as CreateBudgetRequest;
    expect(req.scope).toBe('conversation');
    expect(req.scopeId).toBe('conv-1');
    expect(req.period).toBe('conversation');
    expect(req.amountUsd).toBe(12.5);
  });

  it('shows "Budget ✓" and the existing values when a budget already exists', async () => {
    const existing: Budget = {
      id: 'budget-existing',
      scope: 'conversation',
      scopeId: 'conv-1',
      period: 'conversation',
      amountUsd: 9.99,
      warnThresholdPct: 70,
      hardStop: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    installBridge([existing]);
    renderInRouter(<ChatBudgetOverride conversationId="conv-1" />);
    // Wait until the badge flips from "Set budget" to "Budget ✓"
    await waitFor(() => screen.getByRole('button', { name: /budget ✓/i }));
    fireEvent.click(screen.getByRole('button', { name: /budget ✓/i }));
    const amount = (await screen.findByLabelText('Max spend USD')) as HTMLInputElement;
    expect(amount.value).toBe('9.99');
  });

  it('rejects invalid max spend values', async () => {
    const bridge = installBridge();
    renderInRouter(<ChatBudgetOverride conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: /set budget/i }));
    fireEvent.change(screen.getByLabelText('Max spend USD'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^set$/i }));
    await waitFor(() => screen.getByText(/Enter a max-spend greater than 0/));
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('calls budgets:delete when Clear is pressed on an existing override', async () => {
    const existing: Budget = {
      id: 'budget-existing',
      scope: 'conversation',
      scopeId: 'conv-1',
      period: 'conversation',
      amountUsd: 5,
      warnThresholdPct: 80,
      hardStop: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const bridge = installBridge([existing]);
    renderInRouter(<ChatBudgetOverride conversationId="conv-1" />);
    await waitFor(() => screen.getByRole('button', { name: /budget ✓/i }));
    fireEvent.click(screen.getByRole('button', { name: /budget ✓/i }));
    await screen.findByLabelText('Max spend USD');
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(bridge.delete).toHaveBeenCalledWith('budget-existing'));
  });
});
