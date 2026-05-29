import type { RunPausedChangedEvent } from '../../shared/agent-tree';

type PausedListener = (event: RunPausedChangedEvent) => void;

const paused = new Set<string>();
const waiters = new Map<string, Array<() => void>>();
const listeners = new Set<PausedListener>();

function emit(runId: string, isPaused: boolean): void {
  for (const l of listeners) l({ runId, paused: isPaused });
}

export function onPausedChanged(listener: PausedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPaused(runId: string): boolean {
  return paused.has(runId);
}

export function pauseRun(runId: string): { ok: boolean; error?: string } {
  if (!runId) return { ok: false, error: 'runId required' };
  if (paused.has(runId)) return { ok: true };
  paused.add(runId);
  emit(runId, true);
  return { ok: true };
}

export function resumeRun(runId: string): { ok: boolean; error?: string } {
  if (!runId) return { ok: false, error: 'runId required' };
  if (!paused.has(runId)) return { ok: true };
  paused.delete(runId);
  const queued = waiters.get(runId);
  waiters.delete(runId);
  if (queued) for (const w of queued) w();
  emit(runId, false);
  return { ok: true };
}

/**
 * Awaits until the run is no longer paused, or the abort signal fires.
 * Cheap no-op when the run is not paused. Call this between tool turns
 * from the worker loop to honor pause requests cooperatively.
 */
export async function waitWhilePaused(runId: string, signal?: AbortSignal): Promise<void> {
  if (!paused.has(runId)) return;
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const queue = waiters.get(runId) ?? [];
    const onAbort = (): void => {
      const list = waiters.get(runId);
      if (list) {
        const idx = list.indexOf(resolve);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) waiters.delete(runId);
      }
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    queue.push(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
    waiters.set(runId, queue);
  });
}

export function listPaused(): string[] {
  return Array.from(paused);
}

export function __resetForTests(): void {
  paused.clear();
  waiters.clear();
  listeners.clear();
}
