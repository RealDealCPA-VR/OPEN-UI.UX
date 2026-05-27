import { spawn, type ChildProcess } from 'node:child_process';

export interface TreeKillOptions {
  gracePeriodMs?: number;
}

export function treeKill(child: ChildProcess, opts?: TreeKillOptions): void {
  if (child.killed || child.exitCode !== null || !child.pid) return;
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
    return;
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
  setTimeout(() => {
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
  }, gracePeriodMs).unref();
}
