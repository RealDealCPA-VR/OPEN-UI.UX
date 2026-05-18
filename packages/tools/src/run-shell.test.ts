import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import { runShellTool, scrubEnv } from './run-shell';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('scrubEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps PATH and HOME, drops arbitrary vars', () => {
    const result = scrubEnv({
      PATH: '/usr/bin',
      HOME: '/home/me',
      SECRET_KEY: 'shhh',
      AWS_SECRET_ACCESS_KEY: 'creds',
    });
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/me');
    expect(result.SECRET_KEY).toBeUndefined();
    expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('honors OPENCODEX_SHELL_ENV_KEEP additions', () => {
    const result = scrubEnv({
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      FOO: 'bar',
      OPENCODEX_SHELL_ENV_KEEP: 'NODE_ENV,FOO',
    });
    expect(result.NODE_ENV).toBe('production');
    expect(result.FOO).toBe('bar');
  });

  it('drops undefined values', () => {
    const result = scrubEnv({ PATH: undefined as unknown as string });
    expect('PATH' in result).toBe(false);
  });
});

describe('runShellTool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace();
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('runs a command and captures stdout + exit code', async () => {
    const result = await runShellTool.execute(
      { command: `node -e "console.log('hi')"` },
      makeCtx(ws.root),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hi');
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr and non-zero exit code', async () => {
    const result = await runShellTool.execute(
      { command: `node -e "console.error('oops'); process.exit(2)"` },
      makeCtx(ws.root),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr.trim()).toBe('oops');
  });

  it('runs inside workspace root by default', async () => {
    const result = await runShellTool.execute(
      { command: `node -e "console.log(process.cwd())"` },
      makeCtx(ws.root),
    );
    expect(result.exitCode).toBe(0);
    const reportedCwd = result.stdout.trim();
    expect(reportedCwd.toLowerCase()).toBe(ws.root.toLowerCase());
  });

  it('truncates stdout at maxOutputBytes', async () => {
    const result = await runShellTool.execute(
      {
        command: `node -e "process.stdout.write('x'.repeat(5000))"`,
        maxOutputBytes: 100,
      },
      makeCtx(ws.root),
    );
    expect(result.truncatedStdout).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(100);
  });

  it('times out a hanging command', async () => {
    const result = await runShellTool.execute(
      {
        command: `node -e "setInterval(()=>{},1000)"`,
        timeoutMs: 200,
      },
      makeCtx(ws.root),
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it('scrubs env: child does not see arbitrary parent env vars', async () => {
    vi.stubEnv('OPENCODEX_TEST_SECRET', 'tippytop');
    const result = await runShellTool.execute(
      { command: `node -e "console.log(process.env.OPENCODEX_TEST_SECRET || 'undef')"` },
      makeCtx(ws.root),
    );
    vi.unstubAllEnvs();
    expect(result.stdout.trim()).toBe('undef');
  });

  it('rejects cwd outside workspace', async () => {
    const outside = os.tmpdir();
    await expect(
      runShellTool.execute({ command: 'node --version', cwd: outside }, makeCtx(ws.root)),
    ).rejects.toThrow();
  });

  it('aborts when ctx.signal fires', async () => {
    const ac = new AbortController();
    const ctx = { ...makeCtx(ws.root), signal: ac.signal };
    const promise = runShellTool.execute(
      { command: `node -e "setInterval(()=>{},1000)"`, timeoutMs: 10_000 },
      ctx,
    );
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    expect(result.exitCode === null || result.signal !== null || result.exitCode !== 0).toBe(true);
  });
});
