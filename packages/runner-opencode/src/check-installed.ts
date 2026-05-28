import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const OPENCODE_INSTALL_HINT =
  'Install OpenCode from https://github.com/opencode-ai/opencode';

export const OPENCODE_TIMEOUT_HINT =
  'Installation check timed out — set the CLI path in Settings → Runners or retry.';

const CLI_NAME = 'opencode';

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/;

export interface InstallCheck {
  ok: boolean;
  version?: string;
  hint?: string;
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { killed?: boolean; signal?: string | null; code?: string };
  return e.killed === true || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
}

export async function checkInstalled(cliPath?: string): Promise<InstallCheck> {
  const cmd = cliPath ?? CLI_NAME;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, ['--version'], {
      windowsHide: true,
      timeout: 10_000,
    });
    const combined = `${stdout ?? ''}${stderr ?? ''}`;
    const match = VERSION_RE.exec(combined);
    if (match) return { ok: true, version: match[1] };
    return { ok: true };
  } catch (err) {
    if (isTimeoutError(err)) {
      return { ok: false, hint: OPENCODE_TIMEOUT_HINT };
    }
    return { ok: false, hint: OPENCODE_INSTALL_HINT };
  }
}

function fallbackCandidates(): string[] {
  if (process.platform === 'win32') {
    return [`C:\\Program Files\\${CLI_NAME}\\${CLI_NAME}.exe`];
  }
  const home = process.env.HOME ?? '';
  const list = [`/opt/homebrew/bin/${CLI_NAME}`, `/usr/local/bin/${CLI_NAME}`];
  if (home) list.push(`${home}/.cargo/bin/${CLI_NAME}`);
  return list;
}

export async function autoDetect(): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const probe = isWindows ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(probe, [CLI_NAME], {
      windowsHide: true,
      timeout: 5_000,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (first) return first;
  } catch {
    /* fall through */
  }
  for (const candidate of fallbackCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
