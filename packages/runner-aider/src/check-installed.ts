import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const AIDER_INSTALL_HINT = 'Install Aider from https://aider.chat/docs/install.html';

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/;

export interface InstallCheck {
  ok: boolean;
  version?: string;
  hint?: string;
}

export async function checkInstalled(cliPath?: string): Promise<InstallCheck> {
  const cmd = cliPath ?? 'aider';
  try {
    const { stdout, stderr } = await execFileAsync(cmd, ['--version'], {
      windowsHide: true,
      timeout: 10_000,
    });
    const combined = `${stdout ?? ''}${stderr ?? ''}`;
    const match = VERSION_RE.exec(combined);
    if (match) return { ok: true, version: match[1] };
    return { ok: true };
  } catch {
    return { ok: false, hint: AIDER_INSTALL_HINT };
  }
}

export async function autoDetect(): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const probe = isWindows ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(probe, ['aider'], {
      windowsHide: true,
      timeout: 5_000,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}
