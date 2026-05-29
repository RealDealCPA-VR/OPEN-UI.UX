import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  type Budget,
  type BudgetPeriod,
  type BudgetScope,
  type BudgetSpendSummary,
  type CreateBudgetRequest,
  type UpdateBudgetRequest,
  periodKeyForNow,
} from '../../shared/budgets';
import { getDb } from '../storage/db';

const budgetRowSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['global', 'conversation', 'provider']),
  scope_id: z.string().nullable(),
  period: z.enum(['conversation', 'day', 'month']),
  amount_usd: z.number(),
  warn_threshold_pct: z.number().int(),
  hard_stop: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

type BudgetRow = z.infer<typeof budgetRowSchema>;

const BUDGET_COLUMNS =
  'id, scope, scope_id, period, amount_usd, warn_threshold_pct, hard_stop, created_at, updated_at';

function rowToBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    period: row.period,
    amountUsd: row.amount_usd,
    warnThresholdPct: row.warn_threshold_pct,
    hardStop: row.hard_stop !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BudgetExceededError extends Error {
  readonly budgetId: string;
  readonly scope: BudgetScope;
  readonly scopeId: string | null;
  readonly period: BudgetPeriod;
  readonly spentUsd: number;
  readonly amountUsd: number;

  constructor(args: {
    budgetId: string;
    scope: BudgetScope;
    scopeId: string | null;
    period: BudgetPeriod;
    spentUsd: number;
    amountUsd: number;
  }) {
    super(
      `budget exceeded: ${args.scope}/${args.period} spent $${args.spentUsd.toFixed(4)} of $${args.amountUsd.toFixed(2)} (budget ${args.budgetId})`,
    );
    this.name = 'BudgetExceededError';
    this.budgetId = args.budgetId;
    this.scope = args.scope;
    this.scopeId = args.scopeId;
    this.period = args.period;
    this.spentUsd = args.spentUsd;
    this.amountUsd = args.amountUsd;
  }
}

export interface BudgetCheckContext {
  conversationId: string | null;
  providerId: string | null;
}

export interface BudgetCheckOutcome {
  warnings: BudgetSpendSummary[];
  newlyExceeded: BudgetSpendSummary[];
}

export interface BudgetAccrueInput {
  conversationId: string | null;
  providerId: string | null;
  costUsd: number;
}

export interface BudgetManagerListeners {
  onWarning?(summary: BudgetSpendSummary): void;
  onExceeded?(summary: BudgetSpendSummary): void;
}

function applicableBudgets(all: Budget[], ctx: BudgetCheckContext): Budget[] {
  return all.filter((b) => {
    if (b.scope === 'global') return true;
    if (b.scope === 'conversation') {
      if (b.scopeId === null) return true;
      return ctx.conversationId !== null && b.scopeId === ctx.conversationId;
    }
    if (b.scope === 'provider') {
      if (b.scopeId === null) return true;
      return ctx.providerId !== null && b.scopeId === ctx.providerId;
    }
    return false;
  });
}

export class BudgetManager {
  private listeners: BudgetManagerListeners;
  // The set of (budget, period_key) pairs we've already announced as warning/exceeded since
  // process start. Used so we only emit `budget:warning` once per threshold crossing.
  private warnedKeys = new Set<string>();
  private exceededKeys = new Set<string>();

  constructor(
    private readonly db: Database.Database = getDb(),
    listeners: BudgetManagerListeners = {},
  ) {
    this.listeners = listeners;
  }

  setListeners(listeners: BudgetManagerListeners): void {
    this.listeners = listeners;
  }

  list(): Budget[] {
    const rows = this.db
      .prepare(`SELECT ${BUDGET_COLUMNS} FROM budgets ORDER BY created_at ASC`)
      .all() as unknown[];
    return rows.map((raw) => rowToBudget(budgetRowSchema.parse(raw)));
  }

  get(id: string): Budget | null {
    const raw = this.db
      .prepare(`SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = ?`)
      .get(id) as unknown;
    if (!raw) return null;
    return rowToBudget(budgetRowSchema.parse(raw));
  }

  create(req: CreateBudgetRequest): Budget {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO budgets (id, scope, scope_id, period, amount_usd, warn_threshold_pct, hard_stop)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        req.scope,
        req.scopeId ?? null,
        req.period,
        req.amountUsd,
        req.warnThresholdPct ?? 80,
        req.hardStop === false ? 0 : 1,
      );
    const created = this.get(id);
    if (!created) throw new Error(`create budget: row missing after insert: ${id}`);
    return created;
  }

  update(req: UpdateBudgetRequest): Budget {
    const existing = this.get(req.id);
    if (!existing) throw new Error(`update budget: unknown id: ${req.id}`);
    const next: Budget = {
      ...existing,
      scope: req.scope ?? existing.scope,
      scopeId: req.scopeId === undefined ? existing.scopeId : req.scopeId,
      period: req.period ?? existing.period,
      amountUsd: req.amountUsd ?? existing.amountUsd,
      warnThresholdPct: req.warnThresholdPct ?? existing.warnThresholdPct,
      hardStop: req.hardStop ?? existing.hardStop,
    };
    this.db
      .prepare(
        `UPDATE budgets SET scope = ?, scope_id = ?, period = ?, amount_usd = ?,
           warn_threshold_pct = ?, hard_stop = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        next.scope,
        next.scopeId,
        next.period,
        next.amountUsd,
        next.warnThresholdPct,
        next.hardStop ? 1 : 0,
        req.id,
      );
    const refreshed = this.get(req.id);
    if (!refreshed) throw new Error(`update budget: row missing after update: ${req.id}`);
    // Threshold changed: forget cached emission keys so the next check re-evaluates.
    this.warnedKeys.clear();
    this.exceededKeys.clear();
    return refreshed;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM budgets WHERE id = ?`).run(id);
  }

  getCurrentSpend(ctx: BudgetCheckContext): BudgetSpendSummary[] {
    const budgets = applicableBudgets(this.list(), ctx);
    return budgets.map((b) => this.summarize(b, ctx));
  }

  /**
   * Check spend against every applicable hard-stop budget BEFORE a provider
   * call. Throws BudgetExceededError on the first hard-stop breach so the
   * caller never charges through the cap.
   *
   * Side effect: emits `onWarning`/`onExceeded` for newly crossed thresholds.
   */
  check(ctx: BudgetCheckContext): BudgetCheckOutcome {
    const budgets = applicableBudgets(this.list(), ctx);
    const warnings: BudgetSpendSummary[] = [];
    const newlyExceeded: BudgetSpendSummary[] = [];
    let firstHardStop: BudgetSpendSummary | null = null;
    for (const b of budgets) {
      const summary = this.summarize(b, ctx);
      const emissionKey = `${b.id}:${summary.periodKey}`;
      if (summary.warning && !this.warnedKeys.has(emissionKey)) {
        this.warnedKeys.add(emissionKey);
        warnings.push(summary);
        this.listeners.onWarning?.(summary);
      }
      if (summary.exceeded) {
        if (!this.exceededKeys.has(emissionKey)) {
          this.exceededKeys.add(emissionKey);
          newlyExceeded.push(summary);
          this.listeners.onExceeded?.(summary);
        }
        if (summary.hardStop && firstHardStop === null) firstHardStop = summary;
      }
    }
    if (firstHardStop) {
      throw new BudgetExceededError({
        budgetId: firstHardStop.budgetId,
        scope: firstHardStop.scope,
        scopeId: firstHardStop.scopeId,
        period: firstHardStop.period,
        spentUsd: firstHardStop.spentUsd,
        amountUsd: firstHardStop.amountUsd,
      });
    }
    return { warnings, newlyExceeded };
  }

  /**
   * Accumulate spend against every applicable budget after a provider response
   * returned cost. Idempotency lives at the (budget_id, period_key) UNIQUE
   * index, so concurrent appends use INSERT … ON CONFLICT to accumulate.
   */
  accrue(input: BudgetAccrueInput): void {
    if (input.costUsd <= 0) return;
    const budgets = applicableBudgets(this.list(), {
      conversationId: input.conversationId,
      providerId: input.providerId,
    });
    for (const b of budgets) {
      const periodKey = periodKeyForNow(b.period, input.conversationId);
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO budget_spend (id, budget_id, conversation_id, period_key, spent_usd)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(budget_id, period_key)
           DO UPDATE SET spent_usd = budget_spend.spent_usd + excluded.spent_usd`,
        )
        .run(id, b.id, input.conversationId, periodKey, input.costUsd);
    }
    // After accrual, the next check() must re-evaluate warning/exceeded for these
    // (budget, period) pairs so a cost bump triggers events even if a prior call
    // already burned the cache. We clear lazily — periodKey-keyed sets are small.
  }

  /**
   * Reset the per-period-key emission caches. Mainly used by tests.
   */
  resetEmissionCache(): void {
    this.warnedKeys.clear();
    this.exceededKeys.clear();
  }

  private summarize(b: Budget, ctx: BudgetCheckContext): BudgetSpendSummary {
    const periodKey = periodKeyForNow(b.period, ctx.conversationId);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(spent_usd), 0) AS spent FROM budget_spend
         WHERE budget_id = ? AND period_key = ?`,
      )
      .get(b.id, periodKey) as { spent: number } | undefined;
    const spentUsd = row?.spent ?? 0;
    const ratio = b.amountUsd > 0 ? spentUsd / b.amountUsd : 0;
    return {
      budgetId: b.id,
      scope: b.scope,
      scopeId: b.scopeId,
      period: b.period,
      amountUsd: b.amountUsd,
      spentUsd,
      ratio,
      warnThresholdPct: b.warnThresholdPct,
      hardStop: b.hardStop,
      periodKey,
      exceeded: spentUsd >= b.amountUsd,
      warning: spentUsd >= b.amountUsd * (b.warnThresholdPct / 100),
    };
  }
}

let singleton: BudgetManager | null = null;

export function getBudgetManager(): BudgetManager {
  if (!singleton) singleton = new BudgetManager();
  return singleton;
}

export function setBudgetManagerForTesting(instance: BudgetManager | null): void {
  singleton = instance;
}
