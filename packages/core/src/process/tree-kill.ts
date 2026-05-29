import { spawn, type ChildProcess } from 'node:child_process';

export interface TreeKillOptions {
  gracePeriodMs?: number;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onExit = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

export function treeKill(child: ChildProcess, opts?: TreeKillOptions): Promise<void> {
  if (child.killed || child.exitCode !== null || !child.pid) return Promise.resolve();
  const gracePeriodMs = opts?.gracePeriodMs ?? 2000;
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {});
    } catch {
      // ignore
    }
    return waitForExit(child, gracePeriodMs).then(() => undefined);
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  return waitForExit(child, gracePeriodMs).then((exited) => {
    if (exited) return;
    if (child.exitCode !== null || child.killed || !child.pid) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  });
}
