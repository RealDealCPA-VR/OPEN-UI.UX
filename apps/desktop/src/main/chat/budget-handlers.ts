import { BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  type BudgetExceededEvent,
  type BudgetSpendSummary,
  type BudgetWarningEvent,
  type GetCurrentSpendResponse,
  createBudgetRequestSchema,
  deleteBudgetRequestSchema,
  getCurrentSpendRequestSchema,
  updateBudgetRequestSchema,
} from '../../shared/budgets';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { getBudgetManager } from './budget-manager';

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function summaryToWarning(s: BudgetSpendSummary): BudgetWarningEvent {
  return {
    budgetId: s.budgetId,
    scope: s.scope,
    scopeId: s.scopeId,
    period: s.period,
    spentUsd: s.spentUsd,
    amountUsd: s.amountUsd,
    ratio: s.ratio,
    warnThresholdPct: s.warnThresholdPct,
  };
}

function summaryToExceeded(
  s: BudgetSpendSummary,
  conversationId: string | null,
  providerId: string | null,
): BudgetExceededEvent {
  return {
    budgetId: s.budgetId,
    scope: s.scope,
    scopeId: s.scopeId,
    period: s.period,
    spentUsd: s.spentUsd,
    amountUsd: s.amountUsd,
    hardStop: s.hardStop,
    conversationId,
    providerId,
  };
}

export function emitBudgetWarning(summary: BudgetSpendSummary): void {
  broadcast('budget:warning', summaryToWarning(summary));
}

export function emitBudgetExceeded(
  summary: BudgetSpendSummary,
  conversationId: string | null,
  providerId: string | null,
): void {
  broadcast('budget:exceeded', summaryToExceeded(summary, conversationId, providerId));
}

export function registerBudgetHandlers(): void {
  const manager = getBudgetManager();

  manager.setListeners({
    onWarning: (s) => {
      logger.info(
        { budgetId: s.budgetId, scope: s.scope, ratio: s.ratio },
        'budget warning threshold crossed',
      );
      emitBudgetWarning(s);
    },
    onExceeded: (s) => {
      logger.warn(
        { budgetId: s.budgetId, scope: s.scope, spent: s.spentUsd, amount: s.amountUsd },
        'budget exceeded',
      );
      emitBudgetExceeded(s, null, null);
    },
  });

  registerInvoke('budgets:list', z.void(), () => manager.list());
  registerInvoke('budgets:create', createBudgetRequestSchema, (req) => manager.create(req));
  registerInvoke('budgets:update', updateBudgetRequestSchema, (req) => manager.update(req));
  registerInvoke('budgets:delete', deleteBudgetRequestSchema, (req) => {
    manager.delete(req.id);
    return { ok: true } as const;
  });
  registerInvoke(
    'budgets:get-current-spend',
    getCurrentSpendRequestSchema,
    (req): GetCurrentSpendResponse => {
      const summaries = manager.getCurrentSpend({
        conversationId: req.conversationId ?? null,
        providerId: req.providerId ?? null,
      });
      return { summaries };
    },
  );
}
