import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Budget,
  BudgetExceededEvent,
  BudgetPeriod,
  BudgetScope,
  BudgetWarningEvent,
  CreateBudgetRequest,
  GetCurrentSpendRequest,
  GetCurrentSpendResponse,
  UpdateBudgetRequest,
} from '../../shared/budgets';
import type { ProviderListItem } from '../../shared/provider-config';

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

const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  conversation: 'Per conversation',
  day: 'Per day',
  month: 'Per month',
};

const SCOPE_LABELS: Record<BudgetScope, string> = {
  global: 'Global',
  conversation: 'Conversation',
  provider: 'Provider',
};

interface DraftBudget {
  scope: BudgetScope;
  scopeId: string | null;
  period: BudgetPeriod;
  amountUsd: number;
  warnThresholdPct: number;
  hardStop: boolean;
}

const EMPTY_DRAFT: DraftBudget = {
  scope: 'global',
  scopeId: null,
  period: 'day',
  amountUsd: 5,
  warnThresholdPct: 80,
  hardStop: true,
};

function formatScope(b: Budget): string {
  if (b.scope === 'global') return SCOPE_LABELS.global;
  if (b.scopeId === null) return `${SCOPE_LABELS[b.scope]} (any)`;
  return `${SCOPE_LABELS[b.scope]}: ${b.scopeId}`;
}

export function BudgetsPanel(): JSX.Element {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [draft, setDraft] = useState<DraftBudget>(EMPTY_DRAFT);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, provs] = await Promise.all([
        budgetsBridge().list(),
        window.opencodex.providers.list(),
      ]);
      setBudgets(list);
      setProviders(provs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      await reload();
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const startNew = useCallback(() => {
    setEditing('new');
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  }, []);

  const startEdit = useCallback((b: Budget) => {
    setEditing(b);
    setDraft({
      scope: b.scope,
      scopeId: b.scopeId,
      period: b.period,
      amountUsd: b.amountUsd,
      warnThresholdPct: b.warnThresholdPct,
      hardStop: b.hardStop,
    });
    setSaveError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (!editing) return;
    setSaveError(null);
    try {
      if (editing === 'new') {
        const req: CreateBudgetRequest = {
          scope: draft.scope,
          scopeId: draft.scope === 'global' ? null : draft.scopeId,
          period: draft.period,
          amountUsd: draft.amountUsd,
          warnThresholdPct: draft.warnThresholdPct,
          hardStop: draft.hardStop,
        };
        await budgetsBridge().create(req);
      } else {
        const req: UpdateBudgetRequest = {
          id: editing.id,
          scope: draft.scope,
          scopeId: draft.scope === 'global' ? null : draft.scopeId,
          period: draft.period,
          amountUsd: draft.amountUsd,
          warnThresholdPct: draft.warnThresholdPct,
          hardStop: draft.hardStop,
        };
        await budgetsBridge().update(req);
      }
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [editing, draft, reload]);

  const deleteBudget = useCallback(
    async (b: Budget) => {
      if (
        !confirm(`Delete this ${SCOPE_LABELS[b.scope]} budget? Spend history will also be removed.`)
      )
        return;
      setPendingId(b.id);
      try {
        await budgetsBridge().delete(b.id);
        await reload();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingId((id) => (id === b.id ? null : id));
      }
    },
    [reload],
  );

  const providerOptions = useMemo(
    () =>
      providers.map((p) => ({
        value: p.info.id,
        label: p.info.displayName ?? p.info.id,
      })),
    [providers],
  );

  if (loadError) {
    return (
      <div data-settings-anchor="budgets-load-error" className="field-errors" role="alert">
        Failed to load budgets: {loadError}
      </div>
    );
  }

  if (budgets === null) {
    return (
      <p className="settings-block-hint">
        <span className="mcp-inline-spinner" aria-hidden="true" /> Loading budgets…
      </p>
    );
  }

  return (
    <div className="budgets-panel" data-settings-anchor="budgets">
      <div className="settings-toggle-row">
        <p className="settings-block-hint">
          {budgets.length === 0
            ? 'No spending caps yet — the agent runs unconstrained. Add a budget to set limits by period or provider.'
            : `${budgets.length} budget${budgets.length === 1 ? '' : 's'} active.`}
        </p>
        <button type="button" className="btn" onClick={startNew} disabled={editing !== null}>
          Add budget
        </button>
      </div>

      {budgets.length > 0 ? (
        <div className="settings-block">
          {budgets.map((b, i) => (
            <div key={b.id}>
              {i > 0 ? <div className="settings-divider" /> : null}
              <div data-settings-anchor={`budget-${b.id}`}>
                <BudgetRow
                  budget={b}
                  onEdit={() => startEdit(b)}
                  onDelete={() => void deleteBudget(b)}
                  disabled={pendingId === b.id || editing !== null}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {editing !== null ? (
        <BudgetEditor
          isNew={editing === 'new'}
          draft={draft}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={cancelEdit}
          providerOptions={providerOptions}
          saveError={saveError}
        />
      ) : null}
    </div>
  );
}

function BudgetRow({
  budget,
  onEdit,
  onDelete,
  disabled,
}: {
  budget: Budget;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="settings-toggle-row">
      <div className="settings-block">
        <strong>
          ${budget.amountUsd.toFixed(2)} {PERIOD_LABELS[budget.period]}
        </strong>
        <span className="settings-block-hint">
          {formatScope(budget)} · warn at {budget.warnThresholdPct}% ·{' '}
          {budget.hardStop ? 'hard stop' : 'warn only'}
        </span>
      </div>
      <div className="settings-field-row">
        <button type="button" className="btn" onClick={onEdit} disabled={disabled}>
          Edit
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete} disabled={disabled}>
          Delete
        </button>
      </div>
    </div>
  );
}

function BudgetEditor({
  isNew,
  draft,
  onChange,
  onSave,
  onCancel,
  providerOptions,
  saveError,
}: {
  isNew: boolean;
  draft: DraftBudget;
  onChange: (d: DraftBudget) => void;
  onSave: () => void;
  onCancel: () => void;
  providerOptions: Array<{ value: string; label: string }>;
  saveError: string | null;
}): JSX.Element {
  const patch = (next: Partial<DraftBudget>): void => onChange({ ...draft, ...next });

  return (
    <div className="settings-block settings-anchor-flash">
      <h3 className="settings-subhead">{isNew ? 'New budget' : 'Edit budget'}</h3>

      <div className="settings-field-row">
        <span className="settings-field-label">Scope</span>
        <select
          className="settings-input settings-input-select"
          value={draft.scope}
          onChange={(e) => {
            const scope = e.target.value as BudgetScope;
            patch({ scope, scopeId: scope === 'global' ? null : draft.scopeId });
          }}
        >
          {(['global', 'conversation', 'provider'] as BudgetScope[]).map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {draft.scope === 'provider' ? (
        <div className="settings-field-row">
          <span className="settings-field-label">Provider (leave empty for any provider)</span>
          <select
            className="settings-input settings-input-select"
            value={draft.scopeId ?? ''}
            onChange={(e) => patch({ scopeId: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">Any provider</option>
            {providerOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {draft.scope === 'conversation' ? (
        <div className="settings-field-row">
          <span className="settings-field-label">
            Conversation id (leave empty for every conversation)
          </span>
          <input
            className="settings-input"
            type="text"
            value={draft.scopeId ?? ''}
            onChange={(e) => patch({ scopeId: e.target.value === '' ? null : e.target.value })}
            placeholder="any conversation"
          />
        </div>
      ) : null}

      <div className="settings-field-row">
        <span className="settings-field-label">Period</span>
        <select
          className="settings-input settings-input-select"
          value={draft.period}
          onChange={(e) => patch({ period: e.target.value as BudgetPeriod })}
        >
          {(['conversation', 'day', 'month'] as BudgetPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-field-row">
        <span className="settings-field-label">Amount (USD)</span>
        <input
          className="settings-input"
          type="number"
          min={0.01}
          step={0.01}
          value={draft.amountUsd}
          onChange={(e) => patch({ amountUsd: Number(e.target.value) })}
        />
      </div>

      <div className="settings-field-row">
        <span className="settings-field-label">Warn threshold: {draft.warnThresholdPct}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft.warnThresholdPct}
          onChange={(e) => patch({ warnThresholdPct: Number(e.target.value) })}
        />
      </div>

      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.hardStop}
          onChange={(e) => patch({ hardStop: e.target.checked })}
        />
        <span>Hard stop (refuse provider calls past 100%; otherwise warn only)</span>
      </label>

      {saveError ? (
        <p className="field-errors" role="alert">
          Save failed: {saveError}
        </p>
      ) : null}

      <div className="settings-field-row">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={draft.amountUsd <= 0}
        >
          {isNew ? 'Create budget' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export default BudgetsPanel;
