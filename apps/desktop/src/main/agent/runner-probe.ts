import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunnerProbeResult } from '../../shared/runner-discovery';
import { classifyRunnerError } from './runner-friendly-errors';

const execFileAsync = promisify(execFile);

type ProbeCommand = readonly [string, ...string[]];

const PROBES: Record<string, ProbeCommand> = {
  // `--output-format=stream-json` with `--print` requires `--verbose` on the
  // Claude Code CLI (>=2.x), otherwise it errors out before producing output.
  'claude-code': ['claude', '--print', 'echo', '--output-format', 'stream-json', '--verbose'],
  opencode: ['opencode', '--headless', '--message', 'echo'],
  aider: ['aider', '--yes', '--message', 'echo', '--map-tokens', '0'],
};

const AUTH_PATTERNS: readonly RegExp[] = [
  /not authenticated/i,
  /missing api key/i,
  /\b401\b/,
  /please .* login/i,
  /unauthori[sz]ed/i,
  /credential/i,
];

const PROBE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  result: RunnerProbeResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearRunnerProbeCache(runnerId?: string): void {
  if (runnerId === undefined) cache.clear();
  else cache.delete(runnerId);
}

function detectAuthFailure(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return AUTH_PATTERNS.some((p) => p.test(text));
}

export async function probeRunnerAuth(runnerId: string): Promise<RunnerProbeResult> {
  const now = Date.now();
  const hit = cache.get(runnerId);
  if (hit && hit.expiresAt > now) return hit.result;

  const probe = PROBES[runnerId];
  if (!probe) {
    const result: RunnerProbeResult = {
      ok: true,
      authenticated: true,
    };
    cache.set(runnerId, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  }

  const [cmd, ...args] = probe;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let ranOk = true;

  try {
    const exec = execFileAsync(cmd, args, {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    // These CLIs read a prompt from stdin when one isn't supplied; with the pipe
    // left open they block for several seconds ("no stdin data received in 3s")
    // before proceeding. Close it immediately — the prompt is passed as an arg.
    exec.child.stdin?.end();
    const res = await exec;
    stdout = res.stdout ?? '';
    stderr = res.stderr ?? '';
  } catch (err) {
    ranOk = false;
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? '');
    stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? '');
    if (typeof e.code === 'number') exitCode = e.code;
    else exitCode = -1;
    if (stderr.length === 0) stderr = e.message ?? 'probe failed';
  }

  let result: RunnerProbeResult;
  if (ranOk && exitCode === 0 && !detectAuthFailure(stderr, stdout)) {
    result = { ok: true, authenticated: true };
  } else {
    const authFailed = detectAuthFailure(stderr, stdout);
    const friendly = classifyRunnerError(runnerId, stderr || stdout);
    const r: RunnerProbeResult = {
      ok: ranOk && exitCode === 0,
      authenticated: ranOk && exitCode === 0 && !authFailed,
    };
    if (friendly.suggestedFix !== undefined) r.hint = friendly.suggestedFix;
    else r.hint = friendly.message;
    if (stderr.length > 0) r.rawStderr = stderr.slice(0, 4096);
    result = r;
  }

  cache.set(runnerId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
