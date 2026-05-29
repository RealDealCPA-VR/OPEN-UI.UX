import { spawn } from 'node:child_process';
import {
  type ChatEvent,
  type SubagentRunOptions,
  type SubagentRunner,
  type SubagentRunnerInstallCheck,
} from '@opencodex/core';
import { treeKill } from '@opencodex/core/process/tree-kill';
import type { PluginHost } from '@opencodex/plugin-sdk';
import { LineBuffer } from './line-buffer';
import { AIDER_INSTALL_HINT, autoDetect, checkInstalled } from './check-installed';

const ENV_KEEP: readonly string[] = [
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
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
];

const ENV_KEEP_PREFIX: readonly string[] = ['AIDER_'];

const ENV_KEEP_SUFFIX: readonly string[] = ['_API_KEY', '_API_BASE', '_BASE_URL'];

const ENV_KEEP_EXACT: ReadonlySet<string> = new Set([
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_ORGANIZATION',
  'OPENAI_API_TYPE',
  'OPENAI_API_VERSION',
  'AZURE_API_KEY',
  'AZURE_API_BASE',
  'AZURE_API_VERSION',
  'OLLAMA_HOST',
  'OLLAMA_API_BASE',
]);

function shouldKeepEnv(name: string): boolean {
  if (ENV_KEEP.includes(name)) return true;
  if (ENV_KEEP_EXACT.has(name)) return true;
  for (const p of ENV_KEEP_PREFIX) if (name.startsWith(p)) return true;
  for (const s of ENV_KEEP_SUFFIX) if (name.endsWith(s)) return true;
  return false;
}

function scrubEnv(env: NodeJS.ProcessEnv, overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (shouldKeepEnv(key)) out[key] = value;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');

function stripAnsi(s: string): string {
  return s.replace(CSI_RE, '').replace(OSC_RE, '');
}

function needsShell(cliPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const lower = cliPath.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

async function resolveCliPath(host: PluginHost): Promise<string | null> {
  const configured = await host.getSetting<string>('aiderCliPath');
  if (configured && configured.trim().length > 0) return configured.trim();
  return autoDetect();
}

interface ExtendedRunOptions extends SubagentRunOptions {
  env?: Record<string, string>;
}

export function createAiderRunner(host: PluginHost): SubagentRunner {
  return {
    id: 'aider',
    displayName: 'Aider',
    streaming: false,

    async *run(opts: SubagentRunOptions): AsyncIterable<ChatEvent> {
      const cliPath = await resolveCliPath(host);
      if (!cliPath) {
        host.logger.error('aider: CLI not found', { hint: AIDER_INSTALL_HINT });
        yield {
          type: 'error',
          message: `Aider CLI not found. ${AIDER_INSTALL_HINT}`,
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }

      const envOverrides = (opts as ExtendedRunOptions).env;
      const env = scrubEnv(process.env, envOverrides);
      host.logger.info('aider: spawning', { cliPath, cwd: opts.workspaceRoot });

      const args = [
        '--yes',
        '--no-auto-commits',
        '--no-pretty',
        '--no-stream',
        '--message',
        opts.task,
        '--map-tokens',
        '0',
      ];
      const useShell = needsShell(cliPath);
      const child = spawn(cliPath, args, {
        cwd: opts.workspaceRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: useShell,
      });
      const childStdout = child.stdout;
      const childStderr = child.stderr;
      const childStdin = child.stdin;
      if (!childStdout || !childStderr) {
        void treeKill(child);
        host.logger.error('aider: child stdio unavailable');
        yield {
          type: 'error',
          message: 'Aider CLI child process is missing stdio pipes.',
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }
      childStdin?.end();

      const stdoutBuf = new LineBuffer();
      const stderrChunks: string[] = [];
      const pendingEvents: ChatEvent[] = [];
      let resolveWait: (() => void) | null = null;
      let closed = false;
      let spawnError: Error | null = null;
      let budgetExceeded = false;

      const wake = (): void => {
        if (resolveWait) {
          const r = resolveWait;
          resolveWait = null;
          r();
        }
      };

      const wait = (): Promise<void> =>
        new Promise<void>((resolve) => {
          resolveWait = resolve;
        });

      const emitLine = (line: string): void => {
        const clean = stripAnsi(line);
        pendingEvents.push({ type: 'text_delta', delta: `${clean}\n` });
      };

      const onAbort = (): void => {
        host.logger.warn('aider: abort signal received, killing process tree');
        void treeKill(child);
        wake();
      };
      const signal = opts.signal;
      if (signal) {
        if (signal.aborted) {
          void treeKill(child);
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const maxWallTimeMs = opts.budget?.maxWallTimeMs;
      let budgetTimer: ReturnType<typeof setTimeout> | null = null;
      if (typeof maxWallTimeMs === 'number' && maxWallTimeMs > 0) {
        budgetTimer = setTimeout(() => {
          budgetExceeded = true;
          host.logger.warn('aider: wall-time budget exceeded, killing process tree', {
            maxWallTimeMs,
          });
          void treeKill(child);
          wake();
        }, maxWallTimeMs);
        budgetTimer.unref?.();
      }

      childStdout.setEncoding('utf8');
      childStdout.on('data', (chunk: string) => {
        const lines = stdoutBuf.push(chunk);
        for (const line of lines) emitLine(line);
        wake();
      });
      childStdout.on('error', (err) => {
        host.logger.warn('aider: stdout stream error', { err: String(err) });
      });

      childStderr.setEncoding('utf8');
      childStderr.on('data', (chunk: string) => {
        stderrChunks.push(stripAnsi(chunk));
      });
      childStderr.on('error', (err) => {
        host.logger.warn('aider: stderr stream error', { err: String(err) });
      });

      if (childStdin) {
        childStdin.on('error', (err) => {
          host.logger.warn('aider: stdin stream error', { err: String(err) });
        });
      }

      child.on('error', (err) => {
        spawnError = err;
        host.logger.error('aider: spawn error', { err: String(err) });
        wake();
      });

      let exitCode: number | null = null;
      child.on('close', (code) => {
        const trailing = stdoutBuf.flush();
        for (const line of trailing) emitLine(line);
        exitCode = code;
        closed = true;
        wake();
      });

      try {
        while (true) {
          while (pendingEvents.length > 0) {
            const evt = pendingEvents.shift();
            if (evt) yield evt;
          }
          if (closed) break;
          if (spawnError) break;
          await wait();
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (budgetTimer) clearTimeout(budgetTimer);
        if (!closed) void treeKill(child);
      }

      const finalSpawnError = spawnError as Error | null;
      if (finalSpawnError) {
        yield {
          type: 'error',
          message: `Aider CLI failed to start: ${finalSpawnError.message}`,
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }

      const stderr = stderrChunks.join('').trim();
      if (budgetExceeded) {
        yield {
          type: 'error',
          message: `Aider CLI killed: wall-time budget (${maxWallTimeMs}ms) exceeded.`,
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }
      if (exitCode !== 0) {
        host.logger.warn('aider: CLI exited non-zero', { exitCode, stderr });
        yield {
          type: 'error',
          message: stderr.length > 0 ? stderr : `Aider CLI exited with code ${exitCode ?? 'null'}`,
          retryable: false,
        };
      }
      yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
      yield {
        type: 'done',
        stopReason: exitCode === 0 ? 'end_turn' : 'error',
      };
    },

    async checkInstalled(): Promise<SubagentRunnerInstallCheck> {
      const configured = await host.getSetting<string>('aiderCliPath');
      const cliPath = configured?.trim() ?? (await autoDetect()) ?? undefined;
      return checkInstalled(cliPath);
    },
  };
}
