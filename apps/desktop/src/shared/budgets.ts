import { z } from 'zod';

export const budgetScopeSchema = z.enum(['global', 'conversation', 'provider']);
export type BudgetScope = z.infer<typeof budgetScopeSchema>;

export const budgetPeriodSchema = z.enum(['conversation', 'day', 'month']);
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;

export const budgetSchema = z.object({
  id: z.string().min(1),
  scope: budgetScopeSchema,
  scopeId: z.string().nullable(),
  period: budgetPeriodSchema,
  amountUsd: z.number().positive(),
  warnThresholdPct: z.number().int().min(0).max(100),
  hardStop: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Budget = z.infer<typeof budgetSchema>;

export const createBudgetRequestSchema = z.object({
  scope: budgetScopeSchema,
  scopeId: z.string().nullable().optional(),
  period: budgetPeriodSchema,
  amountUsd: z.number().positive(),
  warnThresholdPct: z.number().int().min(0).max(100).optional(),
  hardStop: z.boolean().optional(),
});

export type CreateBudgetRequest = z.infer<typeof createBudgetRequestSchema>;

export const updateBudgetRequestSchema = z.object({
  id: z.string().min(1),
  scope: budgetScopeSchema.optional(),
  scopeId: z.string().nullable().optional(),
  period: budgetPeriodSchema.optional(),
  amountUsd: z.number().positive().optional(),
  warnThresholdPct: z.number().int().min(0).max(100).optional(),
  hardStop: z.boolean().optional(),
});

export type UpdateBudgetRequest = z.infer<typeof updateBudgetRequestSchema>;

export const deleteBudgetRequestSchema = z.object({
  id: z.string().min(1),
});

export type DeleteBudgetRequest = z.infer<typeof deleteBudgetRequestSchema>;

export const getCurrentSpendRequestSchema = z.object({
  conversationId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
});

export type GetCurrentSpendRequest = z.infer<typeof getCurrentSpendRequestSchema>;

export interface BudgetSpendSummary {
  budgetId: string;
  scope: BudgetScope;
  scopeId: string | null;
  period: BudgetPeriod;
  amountUsd: number;
  spentUsd: number;
  ratio: number;
  warnThresholdPct: number;
  hardStop: boolean;
  periodKey: string;
  exceeded: boolean;
  warning: boolean;
}

export interface GetCurrentSpendResponse {
  summaries: BudgetSpendSummary[];
}

export interface BudgetWarningEvent {
  budgetId: string;
  scope: BudgetScope;
  scopeId: string | null;
  period: BudgetPeriod;
  spentUsd: number;
  amountUsd: number;
  ratio: number;
  warnThresholdPct: number;
}

export interface BudgetExceededEvent {
  budgetId: string;
  scope: BudgetScope;
  scopeId: string | null;
  period: BudgetPeriod;
  spentUsd: number;
  amountUsd: number;
  hardStop: boolean;
  conversationId: string | null;
  providerId: string | null;
}

export const budgetsListChannel = 'budgets:list' as const;
export const budgetsCreateChannel = 'budgets:create' as const;
export const budgetsUpdateChannel = 'budgets:update' as const;
export const budgetsDeleteChannel = 'budgets:delete' as const;
export const budgetsGetCurrentSpendChannel = 'budgets:get-current-spend' as const;
export const budgetWarningEventChannel = 'budget:warning' as const;
export const budgetExceededEventChannel = 'budget:exceeded' as const;

export function periodKeyForNow(period: BudgetPeriod, conversationId: string | null): string {
  return periodKeyForDate(period, new Date(), conversationId);
}

export function periodKeyForDate(
  period: BudgetPeriod,
  date: Date,
  conversationId: string | null,
): string {
  if (period === 'conversation') return conversationId ?? '__no_conversation__';
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  if (period === 'month') return `${yyyy}-${mm}`;
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
