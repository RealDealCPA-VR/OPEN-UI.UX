import { spawn } from 'node:child_process';
import { treeKill } from '@opencodex/core';
import { logger } from '../logger';
import type {
  PackageManager,
  RunnerInstallProgress,
  RunnerInstallRequest,
  RunnerInstallResult,
} from '../../shared/runner-discovery';

type Command = readonly [string, ...string[]];

const INSTALL_COMMANDS: Record<string, Partial<Record<PackageManager, Command>>> = {
  'claude-code': {
    npm: ['npm', 'install', '-g', '@anthropic-ai/claude-code'],
  },
  opencode: {
    npm: ['npm', 'install', '-g', 'opencode'],
  },
  aider: {
    pipx: ['pipx', 'install', 'aider-chat'],
    homebrew: ['brew', 'install', 'aider'],
  },
};

const PACKAGE_MANAGER_BINARIES: Record<PackageManager, string> = {
  npm: 'npm',
  homebrew: 'brew',
  pipx: 'pipx',
  cargo: 'cargo',
};

const STDERR_TAIL_LINES = 8;

function whichBin(): string {
  return process.platform === 'win32' ? 'where.exe' : 'which';
}

function probeBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(whichBin(), [bin], { windowsHide: true });
      let resolved = false;
      const done = (ok: boolean): void => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };
      child.on('error', () => done(false));
      child.on('exit', (code) => done(code === 0));
    } catch {
      resolve(false);
    }
  });
}

export async function getAvailablePackageManagers(): Promise<PackageManager[]> {
  const entries = Object.entries(PACKAGE_MANAGER_BINARIES) as [PackageManager, string][];
  const results = await Promise.all(
    entries.map(async ([manager, bin]) => ({ manager, ok: await probeBinary(bin) })),
  );
  return results.filter((r) => r.ok).map((r) => r.manager);
}

function lastNLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-n).join('\n').trim();
}

export interface InstallRunnerHandles {
  abort: () => void;
}

export async function installRunner(
  req: RunnerInstallRequest,
  emitProgress: (chunk: Omit<RunnerInstallProgress, 'runnerId'>) => void,
  handles?: { onSpawn?: (h: InstallRunnerHandles) => void },
): Promise<RunnerInstallResult> {
  const runnerEntry = INSTALL_COMMANDS[req.runnerId];
  if (!runnerEntry) {
    throw new Error(`unknown runnerId: ${req.runnerId}`);
  }
  const command = runnerEntry[req.packageManager];
  if (!command) {
    throw new Error(
      `runner '${req.runnerId}' has no install command for package manager '${req.packageManager}'`,
    );
  }

  const start = Date.now();
  const [cmd, ...args] = command;

  return await new Promise<RunnerInstallResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let stderrBuf = '';
    let settled = false;
    const settle = (result: RunnerInstallResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    handles?.onSpawn?.({
      abort: () => {
        if (settled) return;
        try {
          treeKill(child);
        } catch (err) {
          logger.debug({ err }, 'treeKill on runner install failed');
        }
      },
    });

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      emitProgress({ stream: 'stdout', chunk });
    });
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      if (stderrBuf.length > 64 * 1024) {
        stderrBuf = stderrBuf.slice(stderrBuf.length - 64 * 1024);
      }
      emitProgress({ stream: 'stderr', chunk });
    });
    child.on('error', (err) => {
      if (settled) return;
      const msg = err instanceof Error ? err.message : String(err);
      emitProgress({ stream: 'stderr', chunk: msg });
      settle({
        ok: false,
        exitCode: -1,
        durationMs: Date.now() - start,
        stderrTail: lastNLines(stderrBuf + '\n' + msg, STDERR_TAIL_LINES),
      });
    });
    child.on('exit', (code) => {
      const exitCode = code ?? -1;
      const tail = lastNLines(stderrBuf, STDERR_TAIL_LINES);
      const result: RunnerInstallResult = {
        ok: exitCode === 0,
        exitCode,
        durationMs: Date.now() - start,
      };
      if (tail.length > 0) result.stderrTail = tail;
      settle(result);
    });
  });
}
