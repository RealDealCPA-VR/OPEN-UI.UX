import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeKill } from '@opencodex/core/process/tree-kill';
import { logger } from '../logger';
import type {
  OllamaInstallProgress,
  OllamaInstallResult,
  OllamaInstallerKind,
} from '../../shared/ollama';

type Command = readonly [string, ...string[]];

/*
 * For the `script` installer we no longer pipe the upstream install.sh into
 * `sh` blind. Instead we:
 *   1. Fetch install.sh into memory.
 *   2. Compute its SHA-256 and compare against the pinned `INSTALL_SCRIPT_SHA256`
 *      below. If you bump this you MUST also update the sentinel in CI so a
 *      surprise upstream change can't ship a different binary to users.
 *   3. Persist the verified bytes to a temp file and invoke `sh <path>`.
 *
 * The pinned hash is intentionally a placeholder so installs fail closed until
 * a maintainer pins a known-good revision. Setting it to an empty string
 * disables the script installer.
 */
const INSTALL_SCRIPT_URL = 'https://ollama.com/install.sh';
const INSTALL_SCRIPT_SHA256 = '';

const INSTALL_COMMANDS: Record<OllamaInstallerKind, Command> = {
  homebrew: ['brew', 'install', 'ollama'],
  winget: ['winget', 'install', '--id', 'Ollama.Ollama', '-e', '--silent'],
  script: ['sh', '-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
};

let scriptInstallerInflight: Promise<OllamaInstallResult> | null = null;

export class ScriptInstallerBusyError extends Error {
  override readonly name = 'ScriptInstallerBusyError';
  constructor() {
    super('Ollama script installer is already running');
  }
}

export class ScriptInstallerChecksumError extends Error {
  override readonly name = 'ScriptInstallerChecksumError';
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Ollama install.sh SHA-256 mismatch (expected ${expected || '<unset>'}, got ${actual}). Refusing to execute unverified install script.`,
    );
  }
}

const INSTALLER_BINARY: Record<OllamaInstallerKind, string> = {
  homebrew: 'brew',
  winget: 'winget',
  script: 'sh',
};

const STDERR_TAIL_LINES = 8;

function whichBin(): string {
  return process.platform === 'win32' ? 'where.exe' : 'which';
}

const PROBE_BINARY_TIMEOUT_MS = 5_000;

function probeBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(whichBin(), [bin], { windowsHide: true });
      let resolved = false;
      const done = (ok: boolean): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore — we just need to stop waiting.
        }
        done(false);
      }, PROBE_BINARY_TIMEOUT_MS);
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

export interface InstallOllamaDeps {
  fetchImpl?: typeof fetch;
  expectedScriptSha256?: string;
}

async function fetchAndVerifyScript(
  emitProgress: (chunk: OllamaInstallProgress) => void,
  fetchImpl: typeof fetch,
  expectedSha: string,
): Promise<string> {
  if (!expectedSha) {
    throw new ScriptInstallerChecksumError('', '<not-fetched>');
  }
  emitProgress({ stream: 'stdout', chunk: `fetching ${INSTALL_SCRIPT_URL}\n` });
  const res = await fetchImpl(INSTALL_SCRIPT_URL);
  if (!res.ok) {
    throw new Error(`failed to fetch install.sh: HTTP ${res.status}`);
  }
  const body = await res.text();
  const actual = createHash('sha256').update(body, 'utf8').digest('hex');
  if (actual !== expectedSha) {
    throw new ScriptInstallerChecksumError(expectedSha, actual);
  }
  emitProgress({
    stream: 'stdout',
    chunk: `verified install.sh sha256=${actual}\n`,
  });
  const dir = mkdtempSync(join(tmpdir(), 'opencodex-ollama-installer-'));
  const path = join(dir, 'install.sh');
  writeFileSync(path, body, { mode: 0o700 });
  return path;
}

export async function installOllama(
  installer: OllamaInstallerKind,
  emitProgress: (chunk: OllamaInstallProgress) => void,
  handles?: { onSpawn?: (h: InstallOllamaHandles) => void },
  deps: InstallOllamaDeps = {},
): Promise<OllamaInstallResult> {
  const command = INSTALL_COMMANDS[installer];
  if (!command) {
    throw new Error(`unknown ollama installer: ${installer}`);
  }
  if (!isSupportedPlatform(installer)) {
    throw new Error(`installer '${installer}' not supported on platform '${process.platform}'`);
  }

  if (installer === 'script') {
    if (scriptInstallerInflight) {
      throw new ScriptInstallerBusyError();
    }
    const run = (async (): Promise<OllamaInstallResult> => {
      const expectedSha = deps.expectedScriptSha256 ?? INSTALL_SCRIPT_SHA256;
      const fetchImpl = deps.fetchImpl ?? fetch;
      const verifiedPath = await fetchAndVerifyScript(emitProgress, fetchImpl, expectedSha);
      return runSpawn(['sh', verifiedPath], emitProgress, handles);
    })();
    scriptInstallerInflight = run;
    try {
      return await run;
    } finally {
      scriptInstallerInflight = null;
    }
  }

  return runSpawn([...command], emitProgress, handles);
}

function runSpawn(
  command: readonly string[],
  emitProgress: (chunk: OllamaInstallProgress) => void,
  handles?: { onSpawn?: (h: InstallOllamaHandles) => void },
): Promise<OllamaInstallResult> {
  const start = Date.now();
  const [cmd, ...args] = command;
  if (cmd === undefined) {
    return Promise.reject(new Error('runSpawn called with an empty command'));
  }

  return new Promise<OllamaInstallResult>((resolve, reject) => {
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
