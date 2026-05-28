import { describe, expect, it, vi, beforeEach } from 'vitest';

interface ExecResult {
  err?: NodeJS.ErrnoException | null;
  stdout?: string;
  stderr?: string;
}

const harness = vi.hoisted(() => {
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
  const state: {
    next: { err?: NodeJS.ErrnoException | null; stdout?: string; stderr?: string };
    calls: Array<{ cmd: string; args: readonly string[] }>;
  } = { next: {}, calls: [] };

  const execFileMock = (
    cmd: string,
    args: readonly string[],
    _options: unknown,
    cb?: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
  ): { kill: () => void } => {
    state.calls.push({ cmd, args });
    const callback = (typeof _options === 'function' ? _options : cb) as
      | ((err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void)
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
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        if (state.next.err) reject(state.next.err);
        else
          resolve({
            stdout: state.next.stdout ?? '',
            stderr: state.next.stderr ?? '',
          });
      });
    });
  };

  return { execFileMock, state };
});

vi.mock('node:child_process', () => ({
  execFile: harness.execFileMock,
}));

vi.mock('node:fs', () => ({
  existsSync: () => false,
}));

import { OPENCODE_INSTALL_HINT, autoDetect, checkInstalled } from './check-installed';

function setExecResult(opts: ExecResult): void {
  harness.state.next = opts;
}

const callRecords = harness.state.calls;

describe('checkInstalled (opencode)', () => {
  beforeEach(() => {
    harness.state.next = {};
    harness.state.calls.length = 0;
  });

  it('returns { ok: true, version } when opencode --version prints a semver-ish string', async () => {
    setExecResult({ stdout: '0.3.1 (OpenCode)\n' });
    const result = await checkInstalled();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('0.3.1');
    expect(result.hint).toBeUndefined();
  });

  it('parses version from stderr when stdout is empty', async () => {
    setExecResult({ stdout: '', stderr: 'opencode v1.0.0-rc.1\n' });
    const result = await checkInstalled();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('1.0.0-rc.1');
  });

  it('returns { ok: true, version: undefined } when output lacks a parseable version', async () => {
    setExecResult({ stdout: 'opencode is alive\n' });
    const result = await checkInstalled();
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it('returns { ok: false, hint } when the CLI is missing (ENOENT)', async () => {
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    setExecResult({ err });
    const result = await checkInstalled();
    expect(result.ok).toBe(false);
    expect(result.hint).toBe(OPENCODE_INSTALL_HINT);
    expect(result.version).toBeUndefined();
  });

  it('uses cliPath override when provided', async () => {
    setExecResult({ stdout: '2.0.0\n' });
    await checkInstalled('/custom/path/opencode');
    expect(callRecords.length).toBeGreaterThan(0);
    expect(callRecords[0]?.cmd).toBe('/custom/path/opencode');
    expect(callRecords[0]?.args).toEqual(['--version']);
  });
});

describe('autoDetect (opencode)', () => {
  beforeEach(() => {
    harness.state.next = {};
    harness.state.calls.length = 0;
  });

  it('returns the first non-empty line from which/where output', async () => {
    setExecResult({ stdout: '/usr/local/bin/opencode\n' });
    const result = await autoDetect();
    expect(result).toBe('/usr/local/bin/opencode');
  });

  it('returns null when the probe fails', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    setExecResult({ err });
    const result = await autoDetect();
    expect(result).toBeNull();
  });
});
