import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { treeKill } from '@opencodex/core/process/tree-kill';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  cwd: z.string().optional().describe('Workspace-relative cwd (defaults to workspace root)'),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(600_000)
    .optional()
    .describe('Hard timeout in ms (default: 30000, max: 600000)'),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .optional()
    .describe('Per-stream output cap in bytes (default: 1048576)'),
});

export interface RunShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

const DEFAULT_ENV_KEEP: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SystemDrive',
  'COMSPEC',
  'PATHEXT',
  'WINDIR',
];

export const runShellTool = defineTool({
  name: 'run_shell',
  description:
    'Run a shell command inside the workspace. Sandboxed: scrubbed env, cwd locked to workspace, output capped, hard timeout.',
  inputZod: input,
  permissionTier: 'execute',
  async execute(args, ctx): Promise<RunShellResult> {
    const cwd = args.cwd
      ? resolveWithinWorkspace(ctx.workspaceRoot, args.cwd)
      : path.resolve(ctx.workspaceRoot);
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = args.maxOutputBytes ?? DEFAULT_MAX_BYTES;
    const env = scrubEnv(process.env);
    const startedAt = Date.now();

    const isWindows = process.platform === 'win32';

    return new Promise<RunShellResult>((resolve, reject) => {
      const child = spawn(args.command, {
        cwd,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !isWindows,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let truncatedStdout = false;
      let truncatedStderr = false;
      let timedOut = false;
      let settled = false;

      const collect = (chunk: Buffer, which: 'stdout' | 'stderr'): void => {
        const chunks = which === 'stdout' ? stdoutChunks : stderrChunks;
        const bytes = which === 'stdout' ? stdoutBytes : stderrBytes;
        if (which === 'stdout' ? truncatedStdout : truncatedStderr) return;
        const remaining = maxBytes - bytes;
        if (chunk.length > remaining) {
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          if (which === 'stdout') {
            stdoutBytes = maxBytes;
            truncatedStdout = true;
          } else {
            stderrBytes = maxBytes;
            truncatedStderr = true;
          }
          treeKill(child);
        } else {
          chunks.push(chunk);
          if (which === 'stdout') stdoutBytes += chunk.length;
          else stderrBytes += chunk.length;
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        treeKill(child);
      }, timeoutMs);

      const onAbort = () => treeKill(child);
      if (ctx.signal.aborted) {
        treeKill(child);
      } else {
        ctx.signal.addEventListener('abort', onAbort, { once: true });
      }

      const finish = () => {
        clearTimeout(timeoutTimer);
        ctx.signal.removeEventListener('abort', onAbort);
      };

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        finish();
        reject(err);
      });

      child.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        finish();
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code,
          signal,
          truncatedStdout,
          truncatedStderr,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  },
});

export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extra = (env.OPENCODEX_SHELL_ENV_KEEP ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const keep = new Set<string>([...DEFAULT_ENV_KEEP, ...extra]);
  const out: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  const pathOverride = env.OPENCODEX_SHELL_PATH?.trim();
  if (pathOverride) {
    out.PATH = pathOverride;
  }
  return out;
}
