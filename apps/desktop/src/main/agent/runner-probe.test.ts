import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeError = Error & { code?: number | string; stdout?: string; stderr?: string };

interface ExecState {
  next: { err?: FakeError | null; stdout?: string; stderr?: string };
  calls: Array<{ cmd: string; args: readonly string[] }>;
}

const harness = vi.hoisted(() => {
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
  const state: ExecState = { next: {}, calls: [] };

  const execFileMock = (
    cmd: string,
    args: readonly string[],
    _options: unknown,
    cb?: (err: Error | null, stdout: string, stderr: string) => void,
  ): { kill: () => void } => {
    state.calls.push({ cmd, args });
    const callback = (typeof _options === 'function' ? _options : cb) as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    if (callback) {
      setImmediate(() =>
        callback(state.next.err ?? null, state.next.stdout ?? '', state.next.stderr ?? ''),
      );
    }
    return { kill: () => {} };
  };

  (execFileMock as unknown as { [k: symbol]: unknown })[promisifyCustom] = (
    cmd: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    state.calls.push({ cmd, args });
    const promise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      setImmediate(() => {
        if (state.next.err) {
          const e = state.next.err;
          e.stdout = state.next.stdout ?? '';
          e.stderr = state.next.stderr ?? '';
          reject(e);
        } else {
          resolve({ stdout: state.next.stdout ?? '', stderr: state.next.stderr ?? '' });
        }
      });
    });
    // Real promisify(execFile) returns a PromiseWithChild; the probe closes
    // child.stdin to avoid the CLI's stdin wait. Mirror that shape here.
    (promise as unknown as { child: unknown }).child = { stdin: { end: () => {} } };
    return promise;
  };

  return { execFileMock, state };
});

vi.mock('node:child_process', () => ({
  execFile: harness.execFileMock,
}));

import { clearRunnerProbeCache, probeRunnerAuth } from './runner-probe';

function setExec(opts: ExecState['next']): void {
  harness.state.next = opts;
}

function spawnCount(): number {
  return harness.state.calls.length;
}

describe('probeRunnerAuth', () => {
  beforeEach(() => {
    harness.state.next = {};
    harness.state.calls.length = 0;
    clearRunnerProbeCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('short-circuits unknown runnerId to ok+authenticated without spawning', async () => {
    const before = spawnCount();
    const result = await probeRunnerAuth('not-a-real-runner');
    expect(result).toEqual({ ok: true, authenticated: true });
    expect(spawnCount()).toBe(before);
  });

  it('returns ok+authenticated on clean stdout and empty stderr', async () => {
    setExec({ stdout: 'echo\n', stderr: '' });
    const result = await probeRunnerAuth('claude-code');
    expect(result.ok).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.hint).toBeUndefined();
  });

  it('flags auth failure when stderr matches an auth pattern', async () => {
    const err: FakeError = Object.assign(new Error('exit 1'), { code: 1 });
    setExec({ err, stderr: 'Error: not authenticated' });
    const result = await probeRunnerAuth('claude-code');
    expect(result.ok).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.hint).toBe("Run 'claude login' in your terminal.");
  });

  it('returns cached result within 60s without re-spawning', async () => {
    setExec({ stdout: 'echo\n' });
    await probeRunnerAuth('claude-code');
    const after1 = spawnCount();
    const second = await probeRunnerAuth('claude-code');
    expect(second).toEqual({ ok: true, authenticated: true });
    expect(spawnCount()).toBe(after1);
  });

  it('re-spawns after cache TTL of 60s elapses', async () => {
    // Fake `Date` so the cache TTL check advances, but leave `setImmediate`
    // real — the execFileMock above uses it to deliver fake results
    // asynchronously, and faking it would deadlock the awaited probe call.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      setExec({ stdout: 'echo\n' });
      await probeRunnerAuth('claude-code');
      const after1 = spawnCount();
      vi.advanceTimersByTime(61_000);
      setExec({ stdout: 'echo\n' });
      await probeRunnerAuth('claude-code');
      expect(spawnCount()).toBeGreaterThan(after1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a friendly hint when the probe times out', async () => {
    const err: FakeError = Object.assign(new Error('Command timed out'), { code: -1 });
    setExec({ err, stderr: 'network ETIMEDOUT' });
    const result = await probeRunnerAuth('claude-code');
    expect(result.ok).toBe(false);
    expect(result.hint).toBeTruthy();
  });

  it('clearRunnerProbeCache forces a re-spawn on next call', async () => {
    setExec({ stdout: 'echo\n' });
    await probeRunnerAuth('opencode');
    const after1 = spawnCount();
    clearRunnerProbeCache();
    setExec({ stdout: 'echo\n' });
    await probeRunnerAuth('opencode');
    expect(spawnCount()).toBeGreaterThan(after1);
  });

  it('clearRunnerProbeCache(id) clears only that runner', async () => {
    setExec({ stdout: 'echo\n' });
    await probeRunnerAuth('opencode');
    await probeRunnerAuth('claude-code');
    const after2 = spawnCount();
    clearRunnerProbeCache('opencode');
    setExec({ stdout: 'echo\n' });
    await probeRunnerAuth('opencode');
    expect(spawnCount()).toBeGreaterThan(after2);
    const beforeClaude = spawnCount();
    await probeRunnerAuth('claude-code');
    expect(spawnCount()).toBe(beforeClaude);
  });
});
