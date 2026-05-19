import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('OPENCODEX_SHELL_PATH overrides parent PATH', () => {
    const result = scrubEnv({
      PATH: '/usr/bin:/inherited',
      OPENCODEX_SHELL_PATH: '/safe/only',
    });
    expect(result.PATH).toBe('/safe/only');
  });

  it('OPENCODEX_SHELL_PATH sets PATH even when parent has none', () => {
    const result = scrubEnv({ OPENCODEX_SHELL_PATH: '/safe/only' });
    expect(result.PATH).toBe('/safe/only');
  });

  it('empty/whitespace OPENCODEX_SHELL_PATH is ignored (falls through to parent)', () => {
    const result = scrubEnv({
      PATH: '/usr/bin',
      OPENCODEX_SHELL_PATH: '   ',
    });
    expect(result.PATH).toBe('/usr/bin');
  });

  it('OPENCODEX_SHELL_PATH itself does not leak into output', () => {
    const result = scrubEnv({
      PATH: '/usr/bin',
      OPENCODEX_SHELL_PATH: '/safe/only',
    });
    expect('OPENCODEX_SHELL_PATH' in result).toBe(false);
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

  it('aborts when ctx.signal fires — terminates well before timeout, not via timeout', async () => {
    const ac = new AbortController();
    const ctx = { ...makeCtx(ws.root), signal: ac.signal };
    const promise = runShellTool.execute(
      { command: `node -e "setInterval(()=>{},1000)"`, timeoutMs: 30_000 },
      ctx,
    );
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    // Process should die well before the 30s timeout (SIGKILL grace is 2s on POSIX).
    expect(result.durationMs).toBeLessThan(8_000);
    // The timeout timer did not fire — abort took it down.
    expect(result.timedOut).toBe(false);
    // Either a POSIX signal was delivered, or the exit code is non-zero (Windows taskkill).
    const killed = result.signal !== null || (result.exitCode !== null && result.exitCode !== 0);
    expect(killed).toBe(true);
  });

  it('kills the entire process tree (child grandprocess does not outlive abort)', async () => {
    const pidFile = path.join(ws.root, 'grandchild.pid');
    const grandchildPath = path.join(ws.root, 'grandchild.cjs');
    const parentPath = path.join(ws.root, 'parent.cjs');

    await fs.writeFile(
      grandchildPath,
      `require('fs').writeFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 1000);\n`,
      'utf8',
    );
    await fs.writeFile(
      parentPath,
      `const {spawn} = require('child_process');\nconst isWin = process.platform === 'win32';\nspawn(process.execPath, [${JSON.stringify(grandchildPath)}, process.argv[2]], { stdio: 'ignore', detached: !isWin });\nsetInterval(() => {}, 1000);\n`,
      'utf8',
    );

    const ac = new AbortController();
    const ctx = { ...makeCtx(ws.root), signal: ac.signal };
    const promise = runShellTool.execute(
      {
        command: `node ${JSON.stringify(parentPath)} ${JSON.stringify(pidFile)}`,
        timeoutMs: 25_000,
      },
      ctx,
    );

    const grandchildPid = await waitForPidFile(pidFile, 8_000);
    ac.abort();
    const result = await promise;
    expect(result.durationMs).toBeLessThan(15_000);
    expect(result.timedOut).toBe(false);

    const dead = await waitForProcessDeath(grandchildPid, 5_000);
    if (!dead) {
      try {
        process.kill(grandchildPid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    expect(dead).toBe(true);
  }, 30_000);
});

async function waitForPidFile(file: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  for (;;) {
    try {
      const raw = (await fs.readFile(file, 'utf8')).trim();
      const pid = Number.parseInt(raw, 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    } catch {
      // not yet
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`grandchild pid file ${file} not written within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForProcessDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (!isAlive(pid)) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
