import { describe, expect, it } from 'vitest';
import { computeNextFire, validateCronExpression } from './scheduler';
import type { ScheduledTask } from '../../shared/scheduled-tasks';

function plainTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'x',
    name: 'x',
    description: '',
    trigger: { type: 'manual' },
    prompt: 'p',
    providerId: 'openai',
    model: 'm',
    workspacePath: '/x',
    allowedTools: [],
    useWorktree: true,
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    lastRunId: null,
    linkedSkillId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('validateCronExpression', () => {
  it('accepts a 5-field cron', () => {
    expect(() => validateCronExpression('0 9 * * *')).not.toThrow();
  });

  it('accepts an interval cron', () => {
    expect(() => validateCronExpression('*/5 * * * *')).not.toThrow();
  });

  it('rejects garbage', () => {
    expect(() => validateCronExpression('not-a-cron')).toThrow();
  });
});

describe('computeNextFire (pure, no DB)', () => {
  it('returns null for manual triggers', () => {
    expect(computeNextFire(plainTask({ trigger: { type: 'manual' } }))).toBeNull();
  });

  it('returns a future date for cron triggers', () => {
    const t = plainTask({ trigger: { type: 'cron', expr: '0 9 * * *' } });
    const after = new Date('2026-05-26T08:00:00Z');
    const next = computeNextFire(t, after);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(after.getTime());
  });

  it('returns a different next-fire when starting from different "after" dates', () => {
    const t = plainTask({ trigger: { type: 'cron', expr: '*/5 * * * *' } });
    const a = computeNextFire(t, new Date('2026-05-26T08:00:00Z'));
    const b = computeNextFire(t, new Date('2026-05-26T08:06:00Z'));
    expect(b!.getTime()).toBeGreaterThan(a!.getTime());
  });

  it('returns null for event-driven trigger types (file-change / git-hook / webhook)', () => {
    expect(
      computeNextFire(plainTask({ trigger: { type: 'file-change', glob: '**/*' } })),
    ).toBeNull();
    expect(
      computeNextFire(plainTask({ trigger: { type: 'git-hook', hook: 'post-commit' } })),
    ).toBeNull();
    expect(computeNextFire(plainTask({ trigger: { type: 'webhook', secret: 's' } }))).toBeNull();
  });
});
