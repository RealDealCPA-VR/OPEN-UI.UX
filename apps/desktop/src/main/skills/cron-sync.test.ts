import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '../../shared/skills';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const created: unknown[] = [];
const updated: unknown[] = [];
const deleted: string[] = [];
let linkedTasksByLinkedSkill: Map<string, { id: string; linkedSkillId: string }> = new Map();
let cronInvalidThrows = false;

vi.mock('../scheduler/store', () => ({
  createTask: (req: unknown) => {
    created.push(req);
    const linkedId = (req as { linkedSkillId?: string }).linkedSkillId;
    const id = `task-${created.length}`;
    if (linkedId) {
      linkedTasksByLinkedSkill.set(linkedId, { id, linkedSkillId: linkedId });
    }
    return { id };
  },
  updateTask: (req: unknown) => {
    updated.push(req);
    return { id: (req as { id: string }).id };
  },
  deleteTask: (id: string) => {
    deleted.push(id);
    for (const [k, v] of linkedTasksByLinkedSkill.entries()) {
      if (v.id === id) linkedTasksByLinkedSkill.delete(k);
    }
  },
  findTaskByLinkedSkill: (id: string) => linkedTasksByLinkedSkill.get(id) ?? null,
  listTasksLinkedToSkills: () => Array.from(linkedTasksByLinkedSkill.values()),
}));

vi.mock('../scheduler/scheduler', () => ({
  validateCronExpression: (expr: string) => {
    if (cronInvalidThrows) throw new Error(`invalid: ${expr}`);
  },
  rescheduleNow: () => undefined,
}));

vi.mock('../storage/settings', () => ({
  getSettings: () => ({ activeWorkspace: '/tmp/workspace' }),
  getSelectedModel: () => ({ providerId: 'openai', modelId: 'gpt-4o-mini' }),
}));

beforeEach(() => {
  created.length = 0;
  updated.length = 0;
  deleted.length = 0;
  linkedTasksByLinkedSkill = new Map();
  cronInvalidThrows = false;
});

afterEach(() => {
  vi.resetModules();
});

function makeSkill(
  name: string,
  opts: { cron?: string; disabled?: boolean; tools?: string[]; runner?: string } = {},
): Skill {
  return {
    id: `user:${name}`,
    name,
    scope: 'user',
    description: `${name} desc`,
    frontmatter: {
      name,
      description: `${name} desc`,
      ...(opts.cron ? { cron: opts.cron } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.runner ? { runner: opts.runner } : {}),
    },
    body: 'body',
    sourcePath: `/tmp/${name}/SKILL.md`,
    disabled: opts.disabled ?? false,
  };
}

describe('syncLinkedScheduledTasks', () => {
  it('creates a task for a skill with a cron field', async () => {
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('nightly', { cron: '0 3 * * *', tools: ['read_file'] })]);
    expect(created).toHaveLength(1);
    const req = created[0] as Record<string, unknown>;
    expect(req.name).toBe('skill:nightly');
    expect(req.linkedSkillId).toBe('user:nightly');
    expect(req.allowedTools).toEqual(['read_file']);
    expect(req.trigger).toEqual({ type: 'cron', expr: '0 3 * * *' });
  });

  it('updates the existing task when called again with the same skill', async () => {
    linkedTasksByLinkedSkill.set('user:nightly', {
      id: 'task-existing',
      linkedSkillId: 'user:nightly',
    });
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('nightly', { cron: '0 4 * * *' })]);
    expect(updated).toHaveLength(1);
    expect((updated[0] as { id: string }).id).toBe('task-existing');
    expect(created).toHaveLength(0);
  });

  it('deletes the linked task when the skill is removed', async () => {
    linkedTasksByLinkedSkill.set('user:gone', { id: 'task-gone', linkedSkillId: 'user:gone' });
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([]);
    expect(deleted).toEqual(['task-gone']);
  });

  it('deletes the linked task when the skill drops its cron field', async () => {
    linkedTasksByLinkedSkill.set('user:foo', { id: 'task-foo', linkedSkillId: 'user:foo' });
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('foo')]); // no cron
    expect(deleted).toEqual(['task-foo']);
  });

  it('deletes the linked task when the skill is disabled', async () => {
    linkedTasksByLinkedSkill.set('user:foo', { id: 'task-foo', linkedSkillId: 'user:foo' });
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('foo', { cron: '0 9 * * *', disabled: true })]);
    expect(deleted).toEqual(['task-foo']);
  });

  it('threads frontmatter.runner into the created task as runnerId', async () => {
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('pinned', { cron: '0 3 * * *', runner: 'claude-code' })]);
    expect(created).toHaveLength(1);
    expect((created[0] as Record<string, unknown>).runnerId).toBe('claude-code');
  });

  it('omits runnerId when the skill has no runner field', async () => {
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('plain', { cron: '0 3 * * *' })]);
    expect(created).toHaveLength(1);
    expect((created[0] as Record<string, unknown>).runnerId).toBeUndefined();
  });

  it('skips skills with invalid cron expressions without crashing', async () => {
    cronInvalidThrows = true;
    const { syncLinkedScheduledTasks } = await import('./manager');
    syncLinkedScheduledTasks([makeSkill('bad', { cron: 'not-a-cron' })]);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });
});
