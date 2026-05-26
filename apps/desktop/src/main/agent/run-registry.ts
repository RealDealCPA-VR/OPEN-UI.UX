import { randomUUID } from 'node:crypto';
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunToolEvent,
  AgentRunTriggerSource,
} from '../../shared/agent-runs';
import type { SubagentResult, SubagentToolEvent } from './subagent';

export type { AgentRun, AgentRunStatus, AgentRunToolEvent };

export interface StartRunInput {
  task: string;
  providerId: string;
  modelId: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeRepoRoot?: string;
  triggerSource?: AgentRunTriggerSource;
  scheduledTaskId?: string;
}

export type MergeStatus = 'pending' | 'merged' | 'rejected';

type Listener = (runs: readonly AgentRun[]) => void;

const MAX_RUNS = 100;

const runs = new Map<string, AgentRun>();
const insertionOrder: string[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = listRuns();
  for (const l of listeners) l(snapshot);
}

function toToolEvents(events: readonly SubagentToolEvent[]): AgentRunToolEvent[] {
  return events.map((e) => ({ name: e.name, isError: e.isError, durationMs: e.durationMs }));
}

function trimIfOverflow(): void {
  while (insertionOrder.length > MAX_RUNS) {
    const evicted = insertionOrder.shift();
    if (evicted !== undefined) runs.delete(evicted);
  }
}

export function recordStart(input: StartRunInput): string {
  const id = randomUUID();
  const hasWorktree =
    input.worktreePath !== undefined &&
    input.worktreeBranch !== undefined &&
    input.worktreeRepoRoot !== undefined;
  const run: AgentRun = {
    id,
    task: input.task,
    providerId: input.providerId,
    modelId: input.modelId,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    toolEvents: [],
    stopReason: null,
    error: null,
    worktreePath: input.worktreePath ?? null,
    worktreeBranch: input.worktreeBranch ?? null,
    worktreeRepoRoot: input.worktreeRepoRoot ?? null,
    mergeStatus: hasWorktree ? 'pending' : null,
    triggerSource: input.triggerSource ?? 'user',
    scheduledTaskId: input.scheduledTaskId ?? null,
  };
  runs.set(id, run);
  insertionOrder.push(id);
  trimIfOverflow();
  emit();
  return id;
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

export function setMergeStatus(id: string, status: MergeStatus): void {
  const existing = runs.get(id);
  if (!existing) return;
  const updated: AgentRun = { ...existing, mergeStatus: status };
  runs.set(id, updated);
  emit();
}

export function recordComplete(id: string, result: SubagentResult): void {
  const existing = runs.get(id);
  if (!existing) return;
  const failed =
    result.stopReason === 'error' ||
    result.stopReason === 'budget_exceeded' ||
    result.stopReason === 'unauthorized_tool';
  const updated: AgentRun = {
    ...existing,
    status: failed ? 'failed' : 'completed',
    completedAt: Date.now(),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    iterations: result.iterations,
    toolEvents: toToolEvents(result.toolEvents),
    stopReason: result.stopReason,
    error: result.error ?? null,
  };
  runs.set(id, updated);
  emit();
}

export function recordError(id: string, error: unknown): void {
  const existing = runs.get(id);
  if (!existing) return;
  const message = error instanceof Error ? error.message : String(error);
  const updated: AgentRun = {
    ...existing,
    status: 'failed',
    completedAt: Date.now(),
    stopReason: 'error',
    error: message,
  };
  runs.set(id, updated);
  emit();
}

export function listRuns(): AgentRun[] {
  const out: AgentRun[] = [];
  for (const id of insertionOrder) {
    const r = runs.get(id);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

export function clear(): void {
  runs.clear();
  insertionOrder.length = 0;
  emit();
}

export function onRunsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only helper to drop all listeners + state. */
export function __resetForTests(): void {
  runs.clear();
  insertionOrder.length = 0;
  listeners.clear();
}
