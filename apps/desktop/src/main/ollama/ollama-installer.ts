import { spawn } from 'node:child_process';
import { treeKill } from '@opencodex/core/process/tree-kill';
import { logger } from '../logger';
import type {
  OllamaInstallProgress,
  OllamaInstallResult,
  OllamaInstallerKind,
} from '../../shared/ollama';

type Command = readonly [string, ...string[]];

const INSTALL_COMMANDS: Record<OllamaInstallerKind, Command> = {
  homebrew: ['brew', 'install', 'ollama'],
  winget: ['winget', 'install', '--id', 'Ollama.Ollama', '-e', '--silent'],
  script: ['sh', '-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
};

const INSTALLER_BINARY: Record<OllamaInstallerKind, string> = {
  homebrew: 'brew',
  winget: 'winget',
  script: 'sh',
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

function isSupportedPlatform(kind: OllamaInstallerKind): boolean {
  switch (kind) {
    case 'homebrew':
      return process.platform === 'darwin' || process.platform === 'linux';
    case 'winget':
      return process.platform === 'win32';
    case 'script':
      return process.platform === 'darwin' || process.platform === 'linux';
    default:
      return false;
  }
}

export async function getAvailableOllamaInstallers(): Promise<OllamaInstallerKind[]> {
  const kinds: OllamaInstallerKind[] = ['homebrew', 'winget', 'script'];
  const out: OllamaInstallerKind[] = [];
  for (const kind of kinds) {
    if (!isSupportedPlatform(kind)) continue;
    const bin = INSTALLER_BINARY[kind];
    if (await probeBinary(bin)) out.push(kind);
  }
  return out;
}

function lastNLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-n).join('\n').trim();
}

export interface InstallOllamaHandles {
  abort: () => void;
}

export async function installOllama(
  installer: OllamaInstallerKind,
  emitProgress: (chunk: OllamaInstallProgress) => void,
  handles?: { onSpawn?: (h: InstallOllamaHandles) => void },
): Promise<OllamaInstallResult> {
  const command = INSTALL_COMMANDS[installer];
  if (!command) {
    throw new Error(`unknown ollama installer: ${installer}`);
  }
  if (!isSupportedPlatform(installer)) {
    throw new Error(`installer '${installer}' not supported on platform '${process.platform}'`);
  }

  const start = Date.now();
  const [cmd, ...args] = command;

  return await new Promise<OllamaInstallResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let stderrBuf = '';
    let settled = false;
    const settle = (result: OllamaInstallResult): void => {
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
          logger.debug({ err }, 'treeKill on ollama install failed');
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
      const result: OllamaInstallResult = {
        ok: exitCode === 0,
        exitCode,
        durationMs: Date.now() - start,
      };
      if (tail.length > 0) result.stderrTail = tail;
      settle(result);
    });
  });
}
