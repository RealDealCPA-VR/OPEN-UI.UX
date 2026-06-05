import type Database from 'better-sqlite3';
import type { AgentRun, AgentRunStatus, AgentRunStopReason } from '../../shared/agent-runs';
import { getDb } from '../storage/db';
import { withSqliteBusyRetry } from '../util/sqlite-retry';

interface RunRow {
  id: string;
  task: string;
  provider_id: string;
  model: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  stop_reason: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  repo_root: string | null;
  runner_id: string | null;
  trigger_source: string;
  scheduled_task_id: string | null;
  parent_run_id: string | null;
  timeline_json: string;
  seen: number;
}

interface TimelinePayload {
  iterations: number;
  toolEvents: AgentRun['toolEvents'];
  error: string | null;
  mergeStatus: AgentRun['mergeStatus'];
  budget?: number;
}

function serializeTimeline(run: AgentRun): string {
  const payload: TimelinePayload = {
    iterations: run.iterations,
    toolEvents: run.toolEvents,
    error: run.error,
    mergeStatus: run.mergeStatus,
    ...(run.budget !== undefined ? { budget: run.budget } : {}),
  };
  return JSON.stringify(payload);
}

function parseTimeline(raw: string): TimelinePayload {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        iterations: typeof obj['iterations'] === 'number' ? obj['iterations'] : 0,
        toolEvents: Array.isArray(obj['toolEvents'])
          ? (obj['toolEvents'] as AgentRun['toolEvents'])
          : [],
        error: typeof obj['error'] === 'string' ? obj['error'] : null,
        mergeStatus: parseMergeStatus(obj['mergeStatus']),
        ...(typeof obj['budget'] === 'number' ? { budget: obj['budget'] } : {}),
      };
    }
  } catch {
    // fall through
  }
  return { iterations: 0, toolEvents: [], error: null, mergeStatus: null };
}

function parseMergeStatus(value: unknown): AgentRun['mergeStatus'] {
  if (value === 'pending' || value === 'merged' || value === 'rejected') return value;
  return null;
}

function parseStatus(value: string): AgentRunStatus {
  if (value === 'running' || value === 'completed' || value === 'failed') return value;
  return 'failed';
}

const VALID_STOP_REASONS: ReadonlyArray<AgentRunStopReason> = [
  'end_turn',
  'tool_use',
  'max_tokens',
  'budget_exceeded',
  'cancelled',
  'error',
  'unauthorized_tool',
  'runner_error',
  'runner_not_installed',
];

function parseStopReason(value: string | null): AgentRunStopReason | null {
  if (value === null) return null;
  return VALID_STOP_REASONS.includes(value as AgentRunStopReason)
    ? (value as AgentRunStopReason)
    : null;
}

function isoToEpoch(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

function epochToIso(epoch: number | null): string | null {
  return epoch === null ? null : new Date(epoch).toISOString();
}

function rowToRun(row: RunRow): AgentRun {
  const timeline = parseTimeline(row.timeline_json);
  const run: AgentRun = {
    id: row.id,
    task: row.task,
    providerId: row.provider_id,
    modelId: row.model,
    runnerId: row.runner_id ?? 'internal',
    status: parseStatus(row.status),
    startedAt: isoToEpoch(row.started_at),
    completedAt: row.completed_at === null ? null : isoToEpoch(row.completed_at),
    inputTokens: row.tokens_input,
    outputTokens: row.tokens_output,
    iterations: timeline.iterations,
    toolEvents: timeline.toolEvents,
    stopReason: parseStopReason(row.stop_reason),
    error: timeline.error,
    worktreePath: row.worktree_path,
    worktreeBranch: row.worktree_branch,
    worktreeRepoRoot: row.repo_root,
    mergeStatus: timeline.mergeStatus,
    triggerSource: row.trigger_source === 'scheduled' ? 'scheduled' : 'user',
    seen: row.seen === 1,
    scheduledTaskId: row.scheduled_task_id,
  };
  if (timeline.budget !== undefined) run.budget = timeline.budget;
  return run;
}

const COLUMNS = `id, task, provider_id, model, status, started_at, completed_at,
  tokens_input, tokens_output, cost_usd, stop_reason, worktree_path,
  worktree_branch, repo_root, runner_id, trigger_source, scheduled_task_id,
  parent_run_id, timeline_json, seen`;

export function upsertRun(run: AgentRun, db: Database.Database = getDb()): void {
  withSqliteBusyRetry(() =>
    db
      .prepare(
        `INSERT INTO agent_runs_persistent (${COLUMNS})
         VALUES (@id, @task, @provider_id, @model, @status, @started_at, @completed_at,
                 @tokens_input, @tokens_output, @cost_usd, @stop_reason, @worktree_path,
                 @worktree_branch, @repo_root, @runner_id, @trigger_source, @scheduled_task_id,
                 @parent_run_id, @timeline_json, @seen)
         ON CONFLICT(id) DO UPDATE SET
           task = excluded.task,
           provider_id = excluded.provider_id,
           model = excluded.model,
           status = excluded.status,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           tokens_input = excluded.tokens_input,
           tokens_output = excluded.tokens_output,
           cost_usd = excluded.cost_usd,
           stop_reason = excluded.stop_reason,
           worktree_path = excluded.worktree_path,
           worktree_branch = excluded.worktree_branch,
           repo_root = excluded.repo_root,
           runner_id = excluded.runner_id,
           trigger_source = excluded.trigger_source,
           scheduled_task_id = excluded.scheduled_task_id,
           parent_run_id = excluded.parent_run_id,
           timeline_json = excluded.timeline_json,
           seen = excluded.seen`,
      )
      .run({
        id: run.id,
        task: run.task,
        provider_id: run.providerId,
        model: run.modelId,
        status: run.status,
        started_at: new Date(run.startedAt).toISOString(),
        completed_at: epochToIso(run.completedAt),
        tokens_input: run.inputTokens,
        tokens_output: run.outputTokens,
        cost_usd: 0,
        stop_reason: run.stopReason,
        worktree_path: run.worktreePath,
        worktree_branch: run.worktreeBranch,
        repo_root: run.worktreeRepoRoot,
        runner_id: run.runnerId,
        trigger_source: run.triggerSource,
        scheduled_task_id: run.scheduledTaskId,
        parent_run_id: null,
        timeline_json: serializeTimeline(run),
        seen: run.seen ? 1 : 0,
      }),
  );
}

export function getRunById(id: string, db: Database.Database = getDb()): AgentRun | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM agent_runs_persistent WHERE id = ?`).get(id) as
    | RunRow
    | undefined;
  return row ? rowToRun(row) : null;
}

export function listAllRuns(db: Database.Database = getDb()): AgentRun[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM agent_runs_persistent ORDER BY started_at DESC`)
    .all() as RunRow[];
  return rows.map(rowToRun);
}

export function listRunningRuns(db: Database.Database = getDb()): AgentRun[] {
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM agent_runs_persistent WHERE status = 'running' ORDER BY started_at DESC`,
    )
    .all() as RunRow[];
  return rows.map(rowToRun);
}

export function markStatus(
  id: string,
  status: AgentRunStatus,
  stopReason: AgentRunStopReason | null,
  completedAt: number | null,
  db: Database.Database = getDb(),
): void {
  withSqliteBusyRetry(() =>
    db
      .prepare(
        `UPDATE agent_runs_persistent
         SET status = ?, stop_reason = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, stopReason, epochToIso(completedAt), id),
  );
}

export function deleteRun(id: string, db: Database.Database = getDb()): void {
  withSqliteBusyRetry(() => db.prepare(`DELETE FROM agent_runs_persistent WHERE id = ?`).run(id));
}

export function clearAllRuns(db: Database.Database = getDb()): void {
  withSqliteBusyRetry(() => db.prepare(`DELETE FROM agent_runs_persistent`).run());
}
