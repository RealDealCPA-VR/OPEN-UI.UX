import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Budget,
  BudgetExceededEvent,
  BudgetWarningEvent,
  CreateBudgetRequest,
  GetCurrentSpendRequest,
  GetCurrentSpendResponse,
  UpdateBudgetRequest,
} from '../../shared/budgets';
import { BudgetSpendIndicator } from './BudgetSpendIndicator';

interface BudgetsBridge {
  list(): Promise<Budget[]>;
  create(req: CreateBudgetRequest): Promise<Budget>;
  update(req: UpdateBudgetRequest): Promise<Budget>;
  delete(id: string): Promise<{ ok: boolean }>;
  getCurrentSpend(req: GetCurrentSpendRequest): Promise<GetCurrentSpendResponse>;
  onWarning(listener: (payload: BudgetWarningEvent) => void): () => void;
  onExceeded(listener: (payload: BudgetExceededEvent) => void): () => void;
}

type BridgeWithBudgets = Window & {
  opencodex: Window['opencodex'] & { budgets: BudgetsBridge };
};

function budgetsBridge(): BudgetsBridge {
  return (window as BridgeWithBudgets).opencodex.budgets;
}

export interface ChatBudgetOverrideProps {
  conversationId: string | null;
  disabled?: boolean;
}

interface FormState {
  amount: string;
  warnPct: string;
  hardStop: boolean;
}

const DEFAULT_FORM: FormState = { amount: '5.00', warnPct: '80', hardStop: true };

function findConversationBudget(budgets: readonly Budget[], conversationId: string): Budget | null {
  for (const b of budgets) {
    if (b.scope === 'conversation' && b.scopeId === conversationId) return b;
  }
  return null;
}

export function ChatBudgetOverride({
  conversationId,
  disabled = false,
}: ChatBudgetOverrideProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<Budget | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadExisting = useCallback(async () => {
    if (!conversationId) return;
    try {
      const list = await budgetsBridge().list();
      const found = findConversationBudget(list, conversationId);
      setExisting(found);
      if (found) {
        setForm({
          amount: found.amountUsd.toFixed(2),
          warnPct: String(found.warnThresholdPct),
          hardStop: found.hardStop,
        });
      } else {
        setForm(DEFAULT_FORM);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadExisting();
    });
    return () => {
      cancelled = true;
    };
  }, [loadExisting]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSave = async (): Promise<void> => {
    if (!conversationId) return;
    const amount = Number(form.amount);
    const warnPct = Number(form.warnPct);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a max-spend greater than 0.');
      return;
    }
    if (!Number.isFinite(warnPct) || warnPct < 0 || warnPct > 100) {
      setError('Warn % must be between 0 and 100.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await budgetsBridge().update({
          id: existing.id,
          amountUsd: amount,
          warnThresholdPct: Math.round(warnPct),
          hardStop: form.hardStop,
        });
      } else {
        await budgetsBridge().create({
          scope: 'conversation',
          scopeId: conversationId,
          period: 'conversation',
          amountUsd: amount,
          warnThresholdPct: Math.round(warnPct),
          hardStop: form.hardStop,
        });
      }
      setOpen(false);
      await loadExisting();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (): Promise<void> => {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      await budgetsBridge().delete(existing.id);
      setExisting(null);
      setForm(DEFAULT_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!conversationId) return null;

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <BudgetSpendIndicator conversationId={conversationId} />
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Override the spending cap just for this conversation"
      >
        {existing ? 'Budget ✓' : 'Set budget'}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Per-conversation budget"
          data-testid="chat-budget-override-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 20,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: 12,
            minWidth: 240,
            boxShadow: 'var(--shadow-popover, 0 6px 20px rgba(0,0,0,0.18))',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 12,
          }}
        >
          <strong style={{ fontSize: 12 }}>
            {existing ? 'Conversation budget' : 'New conversation budget'}
          </strong>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Max spend (USD)</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              aria-label="Max spend USD"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Warn at {form.warnPct}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.warnPct}
              onChange={(e) => setForm((f) => ({ ...f, warnPct: e.target.value }))}
              aria-label="Warn percent"
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.hardStop}
              onChange={(e) => setForm((f) => ({ ...f, hardStop: e.target.checked }))}
            />
            <span>Hard stop at 100%</span>
          </label>
          {error ? (
            <p style={{ color: 'var(--danger)', margin: 0, fontSize: 11 }}>{error}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {existing ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={() => void handleClear()}
              >
                Clear
              </button>
            ) : null}
            <button type="button" className="btn" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {existing ? 'Update' : 'Set'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ChatBudgetOverride;
