import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  isPaused,
  listPaused,
  onPausedChanged,
  pauseRun,
  resumeRun,
  waitWhilePaused,
} from './pause-resume';

describe('pause-resume', () => {
  beforeEach(() => {
    __resetForTests();
  });
  afterEach(() => {
    __resetForTests();
  });

  it('pauses a run and reports paused state', () => {
    expect(isPaused('r1')).toBe(false);
    const result = pauseRun('r1');
    expect(result.ok).toBe(true);
    expect(isPaused('r1')).toBe(true);
    expect(listPaused()).toEqual(['r1']);
  });

  it('resumes a paused run', () => {
    pauseRun('r1');
    const result = resumeRun('r1');
    expect(result.ok).toBe(true);
    expect(isPaused('r1')).toBe(false);
    expect(listPaused()).toEqual([]);
  });

  it('rejects empty runId', () => {
    expect(pauseRun('').ok).toBe(false);
    expect(resumeRun('').ok).toBe(false);
  });

  it('pausing an already-paused run is idempotent', () => {
    pauseRun('r1');
    const result = pauseRun('r1');
    expect(result.ok).toBe(true);
    expect(listPaused()).toEqual(['r1']);
  });

  it('resuming a non-paused run is idempotent', () => {
    const result = resumeRun('nope');
    expect(result.ok).toBe(true);
  });

  it('waitWhilePaused resolves immediately when not paused', async () => {
    await expect(waitWhilePaused('r1')).resolves.toBeUndefined();
  });

  it('waitWhilePaused blocks while paused and resolves on resume', async () => {
    pauseRun('r1');
    const spy = vi.fn();
    const pending = waitWhilePaused('r1').then(spy);
    await new Promise((r) => setTimeout(r, 5));
    expect(spy).not.toHaveBeenCalled();
    resumeRun('r1');
    await pending;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('waitWhilePaused honors an abort signal even while paused', async () => {
    pauseRun('r1');
    const controller = new AbortController();
    const pending = waitWhilePaused('r1', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(isPaused('r1')).toBe(true);
  });

  it('emits paused-changed events to listeners', () => {
    const events: Array<{ runId: string; paused: boolean }> = [];
    const off = onPausedChanged((e) => events.push(e));
    pauseRun('r1');
    resumeRun('r1');
    off();
    pauseRun('r2');
    expect(events).toEqual([
      { runId: 'r1', paused: true },
      { runId: 'r1', paused: false },
    ]);
  });
});
