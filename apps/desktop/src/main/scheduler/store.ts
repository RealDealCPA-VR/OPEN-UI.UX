import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  CreateScheduledTaskRequest,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskStatus,
  UpdateScheduledTaskRequest,
} from '../../shared/scheduled-tasks';
import { getDb } from '../storage/db';
import { parseTriggerJson, serializeTrigger, triggerSchema } from '../triggers/types';

const statusSchema = z.enum(['idle', 'running', 'completed', 'failed']);

const taskRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  trigger_json: z.string().min(1),
  prompt: z.string().min(1),
  provider_id: z.string().min(1),
  model: z.string().min(1),
  workspace_path: z.string().min(1),
  allowed_tools_json: z.string(),
  use_worktree: z.number().int(),
  enabled: z.number().int(),
  last_run_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  last_status: z.string().nullable(),
  last_run_id: z.string().nullable(),
  linked_skill_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const runRowSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  started_at: z.string().min(1),
  completed_at: z.string().nullable(),
  status: statusSchema,
  agent_run_id: z.string().nullable(),
  error_message: z.string().nullable(),
  was_catchup: z.number().int(),
});

type TaskRow = z.infer<typeof taskRowSchema>;
type RunRow = z.infer<typeof runRowSchema>;

const allowedToolsJsonSchema = z.array(z.string());

function rowToTask(row: TaskRow): ScheduledTask {
  const trigger = parseTriggerJson(row.trigger_json);
  let allowedTools: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_tools_json);
    allowedTools = allowedToolsJsonSchema.parse(parsed);
  } catch {
    allowedTools = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger,
    prompt: row.prompt,
    providerId: row.provider_id,
    model: row.model,
    workspacePath: row.workspace_path,
    allowedTools,
    useWorktree: row.use_worktree !== 0,
    enabled: row.enabled !== 0,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status === null ? null : (row.last_status as ScheduledTaskStatus),
    lastRunId: row.last_run_id,
    linkedSkillId: row.linked_skill_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    agentRunId: row.agent_run_id,
    errorMessage: row.error_message,
    wasCatchup: row.was_catchup !== 0,
  };
}

const TASK_COLUMNS =
  'id, name, description, trigger_json, prompt, provider_id, model, workspace_path, allowed_tools_json, use_worktree, enabled, last_run_at, next_run_at, last_status, last_run_id, linked_skill_id, created_at, updated_at';
const RUN_COLUMNS =
  'id, task_id, started_at, completed_at, status, agent_run_id, error_message, was_catchup';

export function listTasks(db: Database.Database = getDb()): ScheduledTask[] {
  const rows = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks ORDER BY created_at ASC`)
    .all() as unknown[];
  return rows.map((raw) => rowToTask(taskRowSchema.parse(raw)));
}

export function getTask(id: string, db: Database.Database = getDb()): ScheduledTask | null {
  const raw = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE id = ?`)
    .get(id) as unknown;
  if (!raw) return null;
  return rowToTask(taskRowSchema.parse(raw));
}

export function createTask(
  req: CreateScheduledTaskRequest,
  db: Database.Database = getDb(),
): ScheduledTask {
  const trigger = triggerSchema.parse(req.trigger);
  const id = randomUUID();
  const allowed = req.allowedTools ?? [];
  db.prepare(
    `INSERT INTO scheduled_tasks
       (id, name, description, trigger_json, prompt, provider_id, model, workspace_path,
        allowed_tools_json, use_worktree, enabled, linked_skill_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.name,
    req.description ?? '',
    serializeTrigger(trigger),
    req.prompt,
    req.providerId,
    req.model,
    req.workspacePath,
    JSON.stringify(allowed),
    req.useWorktree === false ? 0 : 1,
    req.enabled === false ? 0 : 1,
    req.linkedSkillId ?? null,
  );
  const created = getTask(id, db);
  if (!created) throw new Error(`createTask: row missing after insert: ${id}`);
  return created;
}

export function updateTask(
  req: UpdateScheduledTaskRequest,
  db: Database.Database = getDb(),
): ScheduledTask {
  const existing = getTask(req.id, db);
  if (!existing) throw new Error(`updateTask: unknown task: ${req.id}`);
  const next: ScheduledTask = {
    ...existing,
    name: req.name ?? existing.name,
    description: req.description ?? existing.description,
    trigger: req.trigger ? triggerSchema.parse(req.trigger) : existing.trigger,
    prompt: req.prompt ?? existing.prompt,
    providerId: req.providerId ?? existing.providerId,
    model: req.model ?? existing.model,
    workspacePath: req.workspacePath ?? existing.workspacePath,
    allowedTools: req.allowedTools ?? existing.allowedTools,
    useWorktree: req.useWorktree ?? existing.useWorktree,
    enabled: req.enabled ?? existing.enabled,
    linkedSkillId: req.linkedSkillId === undefined ? existing.linkedSkillId : req.linkedSkillId,
  };
  db.prepare(
    `UPDATE scheduled_tasks SET
       name = ?, description = ?, trigger_json = ?, prompt = ?, provider_id = ?, model = ?,
       workspace_path = ?, allowed_tools_json = ?, use_worktree = ?, enabled = ?,
       linked_skill_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    next.name,
    next.description,
    serializeTrigger(next.trigger),
    next.prompt,
    next.providerId,
    next.model,
    next.workspacePath,
    JSON.stringify(next.allowedTools),
    next.useWorktree ? 1 : 0,
    next.enabled ? 1 : 0,
    next.linkedSkillId ?? null,
    req.id,
  );
  const refreshed = getTask(req.id, db);
  if (!refreshed) throw new Error(`updateTask: row missing after update: ${req.id}`);
  return refreshed;
}

export function deleteTask(id: string, db: Database.Database = getDb()): void {
  db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
}

export function findTaskByLinkedSkill(
  linkedSkillId: string,
  db: Database.Database = getDb(),
): ScheduledTask | null {
  const raw = db
    .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE linked_skill_id = ?`)
    .get(linkedSkillId) as unknown;
  if (!raw) return null;
  return rowToTask(taskRowSchema.parse(raw));
}

export function listTasksLinkedToSkills(db: Database.Database = getDb()): ScheduledTask[] {
  const rows = db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE linked_skill_id IS NOT NULL ORDER BY created_at ASC`,
    )
    .all() as unknown[];
  return rows.map((raw) => rowToTask(taskRowSchema.parse(raw)));
}

export interface UpdateRunBookkeepingInput {
  lastRunAt?: string;
  nextRunAt?: string | null;
  lastStatus?: ScheduledTaskStatus;
  lastRunId?: string | null;
}

export function setTaskRunBookkeeping(
  id: string,
  input: UpdateRunBookkeepingInput,
  db: Database.Database = getDb(),
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.lastRunAt !== undefined) {
    sets.push('last_run_at = ?');
    params.push(input.lastRunAt);
  }
  if (input.nextRunAt !== undefined) {
    sets.push('next_run_at = ?');
    params.push(input.nextRunAt);
  }
  if (input.lastStatus !== undefined) {
    sets.push('last_status = ?');
    params.push(input.lastStatus);
  }
  if (input.lastRunId !== undefined) {
    sets.push('last_run_id = ?');
    params.push(input.lastRunId);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export interface RecordRunInput {
  taskId: string;
  status: ScheduledTaskStatus;
  agentRunId?: string | null;
  errorMessage?: string | null;
  wasCatchup?: boolean;
}

export function recordRunStart(input: RecordRunInput, db: Database.Database = getDb()): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO scheduled_task_runs
       (id, task_id, started_at, status, agent_run_id, error_message, was_catchup)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
  ).run(
    id,
    input.taskId,
    input.status,
    input.agentRunId ?? null,
    input.errorMessage ?? null,
    input.wasCatchup ? 1 : 0,
  );
  return id;
}

export interface CompleteRunInput {
  runId: string;
  status: ScheduledTaskStatus;
  agentRunId?: string | null;
  errorMessage?: string | null;
}

export function recordRunCompletion(
  input: CompleteRunInput,
  db: Database.Database = getDb(),
): void {
  db.prepare(
    `UPDATE scheduled_task_runs
       SET completed_at = CURRENT_TIMESTAMP,
           status = ?,
           agent_run_id = COALESCE(?, agent_run_id),
           error_message = COALESCE(?, error_message)
     WHERE id = ?`,
  ).run(input.status, input.agentRunId ?? null, input.errorMessage ?? null, input.runId);
}

export interface ListRunsOptions {
  taskId: string;
  limit?: number;
  beforeId?: string | null;
}

export interface ListRunsResult {
  runs: ScheduledTaskRun[];
  nextCursor: string | null;
}

export function listRuns(opts: ListRunsOptions, db: Database.Database = getDb()): ListRunsResult {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  let rows: unknown[];
  if (opts.beforeId) {
    const cursor = db
      .prepare(`SELECT rowid AS rid FROM scheduled_task_runs WHERE id = ?`)
      .get(opts.beforeId) as { rid: number } | undefined;
    if (!cursor) {
      rows = [];
    } else {
      rows = db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM scheduled_task_runs
           WHERE task_id = ? AND rowid < ?
           ORDER BY rowid DESC LIMIT ?`,
        )
        .all(opts.taskId, cursor.rid, limit + 1) as unknown[];
    }
  } else {
    rows = db
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM scheduled_task_runs
         WHERE task_id = ?
         ORDER BY rowid DESC LIMIT ?`,
      )
      .all(opts.taskId, limit + 1) as unknown[];
  }
  const parsed: ScheduledTaskRun[] = rows.map((raw) => rowToRun(runRowSchema.parse(raw)));
  let nextCursor: string | null = null;
  if (parsed.length > limit) {
    parsed.length = limit;
    const last = parsed[parsed.length - 1];
    nextCursor = last ? last.id : null;
  }
  return { runs: parsed, nextCursor };
}

export function getRun(id: string, db: Database.Database = getDb()): ScheduledTaskRun | null {
  const raw = db
    .prepare(`SELECT ${RUN_COLUMNS} FROM scheduled_task_runs WHERE id = ?`)
    .get(id) as unknown;
  if (!raw) return null;
  return rowToRun(runRowSchema.parse(raw));
}
