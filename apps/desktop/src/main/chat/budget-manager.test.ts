import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { BudgetExceededError, BudgetManager } from './budget-manager';

let db: Database.Database;
let manager: BudgetManager;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  manager = new BudgetManager(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('BudgetManager — CRUD', () => {
  it('creates and reads back a global day budget', () => {
    const created = manager.create({
      scope: 'global',
      period: 'day',
      amountUsd: 5,
      warnThresholdPct: 80,
      hardStop: true,
    });
    expect(created.id).toBeTruthy();
    expect(created.scope).toBe('global');
    expect(created.scopeId).toBeNull();
    expect(created.amountUsd).toBe(5);
    expect(created.warnThresholdPct).toBe(80);
    expect(created.hardStop).toBe(true);

    const all = manager.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(created.id);
  });

  it('uses sensible defaults for warnThresholdPct and hardStop', () => {
    const created = manager.create({ scope: 'global', period: 'day', amountUsd: 1 });
    expect(created.warnThresholdPct).toBe(80);
    expect(created.hardStop).toBe(true);
  });

  it('updates the amount and threshold', () => {
    const b = manager.create({ scope: 'global', period: 'day', amountUsd: 5 });
    const updated = manager.update({ id: b.id, amountUsd: 10, warnThresholdPct: 50 });
    expect(updated.amountUsd).toBe(10);
    expect(updated.warnThresholdPct).toBe(50);
  });

  it('deletes a budget and cascades its spend rows', () => {
    const b = manager.create({ scope: 'global', period: 'day', amountUsd: 5 });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 1 });
    expect(manager.getCurrentSpend({ conversationId: null, providerId: null })[0]?.spentUsd).toBe(
      1,
    );
    manager.delete(b.id);
    expect(manager.list()).toHaveLength(0);
    const spendRows = db.prepare('SELECT COUNT(*) AS n FROM budget_spend').get() as { n: number };
    expect(spendRows.n).toBe(0);
  });
});

describe('BudgetManager — applicability', () => {
  it('matches conversation-scoped budgets only when scopeId matches', () => {
    manager.create({
      scope: 'conversation',
      scopeId: 'conv-a',
      period: 'conversation',
      amountUsd: 1,
    });
    manager.create({
      scope: 'conversation',
      scopeId: 'conv-b',
      period: 'conversation',
      amountUsd: 1,
    });
    expect(
      manager.getCurrentSpend({ conversationId: 'conv-a', providerId: null }).map((s) => s.scopeId),
    ).toEqual(['conv-a']);
  });

  it('matches provider-scoped budgets only when providerId matches', () => {
    manager.create({ scope: 'provider', scopeId: 'openai', period: 'day', amountUsd: 5 });
    manager.create({ scope: 'provider', scopeId: 'anthropic', period: 'day', amountUsd: 5 });
    expect(
      manager.getCurrentSpend({ conversationId: null, providerId: 'openai' }).map((s) => s.scopeId),
    ).toEqual(['openai']);
  });

  it('global budgets match every context', () => {
    manager.create({ scope: 'global', period: 'day', amountUsd: 5 });
    expect(manager.getCurrentSpend({ conversationId: null, providerId: null })).toHaveLength(1);
    expect(manager.getCurrentSpend({ conversationId: 'x', providerId: 'y' })).toHaveLength(1);
  });
});

describe('BudgetManager — check + accrue', () => {
  it('accrue accumulates spend within the same period_key', () => {
    manager.create({ scope: 'global', period: 'day', amountUsd: 5 });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 1 });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 2.5 });
    const summary = manager.getCurrentSpend({ conversationId: null, providerId: null })[0];
    expect(summary?.spentUsd).toBeCloseTo(3.5, 4);
    expect(summary?.ratio).toBeCloseTo(0.7, 4);
    expect(summary?.exceeded).toBe(false);
  });

  it('check does not throw while under the cap', () => {
    manager.create({ scope: 'global', period: 'day', amountUsd: 5 });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 1 });
    expect(() => manager.check({ conversationId: null, providerId: null })).not.toThrow();
  });

  it('check throws BudgetExceededError at the hard-stop cap', () => {
    const b = manager.create({ scope: 'global', period: 'day', amountUsd: 5, hardStop: true });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 5 });
    let caught: unknown = null;
    try {
      manager.check({ conversationId: null, providerId: null });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect((caught as BudgetExceededError).budgetId).toBe(b.id);
  });

  it('check does not throw when hard_stop is false even when exceeded', () => {
    manager.create({ scope: 'global', period: 'day', amountUsd: 1, hardStop: false });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 2 });
    const outcome = manager.check({ conversationId: null, providerId: null });
    expect(outcome.newlyExceeded).toHaveLength(1);
  });

  it('emits onWarning when crossing the warn threshold once', () => {
    const onWarning = vi.fn();
    manager.setListeners({ onWarning });
    manager.create({ scope: 'global', period: 'day', amountUsd: 10, warnThresholdPct: 50 });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 5 });
    manager.check({ conversationId: null, providerId: null });
    manager.check({ conversationId: null, providerId: null });
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it('emits onExceeded once when crossing the hard cap on a warn-only budget', () => {
    const onExceeded = vi.fn();
    manager.setListeners({ onExceeded });
    manager.create({ scope: 'global', period: 'day', amountUsd: 1, hardStop: false });
    manager.accrue({ conversationId: null, providerId: null, costUsd: 1.5 });
    manager.check({ conversationId: null, providerId: null });
    manager.check({ conversationId: null, providerId: null });
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });

  it('warning summary carries scope, period, and ratio fields', () => {
    const onWarning = vi.fn();
    manager.setListeners({ onWarning });
    manager.create({
      scope: 'provider',
      scopeId: 'openai',
      period: 'day',
      amountUsd: 4,
      warnThresholdPct: 50,
    });
    manager.accrue({ conversationId: null, providerId: 'openai', costUsd: 2 });
    manager.check({ conversationId: null, providerId: 'openai' });
    expect(onWarning).toHaveBeenCalledTimes(1);
    const call = onWarning.mock.calls[0]?.[0];
    expect(call).toMatchObject({ scope: 'provider', scopeId: 'openai', period: 'day' });
  });
});
