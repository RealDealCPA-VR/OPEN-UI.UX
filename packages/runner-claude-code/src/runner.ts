import { spawn } from 'node:child_process';
import {
  type ChatEvent,
  type SubagentRunOptions,
  type SubagentRunner,
  type SubagentRunnerInstallCheck,
} from '@opencodex/core';
import { treeKill } from '@opencodex/core/process/tree-kill';
import type { PluginHost } from '@opencodex/plugin-sdk';
import { NdjsonBuffer, createTranslatorState, translateClaudeJson } from './event-translator';
import { CLAUDE_INSTALL_HINT, autoDetect, checkInstalled } from './check-installed';

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

const ENV_KEEP_PREFIX: readonly string[] = ['ANTHROPIC_', 'CLAUDE_'];

const ENV_KEEP_SUFFIX: readonly string[] = ['_API_KEY', '_API_BASE', '_BASE_URL'];

const ENV_KEEP_EXACT: ReadonlySet<string> = new Set(['ANTHROPIC_AUTH_TOKEN']);

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

interface SpawnInvocation {
  command: string;
  args: string[];
}

/**
 * Build a spawn invocation that NEVER enables `shell: true`. On Windows, batch
 * wrappers (`.cmd`/`.bat`) and PowerShell scripts (`.ps1`) cannot be executed
 * directly by `CreateProcess`, so they are routed through the appropriate
 * interpreter with the original args kept as discrete argv elements. Because
 * `shell` stays false, Node escapes each element for `CreateProcess` and the
 * task string is delivered verbatim — `cmd.exe` never re-interprets `&`, `|`,
 * `>` etc. embedded in the task (command-injection guard).
 */
function buildSpawnInvocation(cliPath: string, args: readonly string[]): SpawnInvocation {
  if (process.platform === 'win32') {
    const lower = cliPath.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      const comspec = process.env.COMSPEC ?? 'cmd.exe';
      return { command: comspec, args: ['/d', '/s', '/c', cliPath, ...args] };
    }
    if (lower.endsWith('.ps1')) {
      return {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          cliPath,
          ...args,
        ],
      };
    }
  }
  return { command: cliPath, args: [...args] };
}

async function resolveCliPath(host: PluginHost): Promise<string | null> {
  const configured = await host.getSetting<string>('claudeCliPath');
  if (configured && configured.trim().length > 0) return configured.trim();
  return autoDetect();
}

interface ExtendedRunOptions extends SubagentRunOptions {
  env?: Record<string, string>;
}

export function createClaudeCodeRunner(host: PluginHost): SubagentRunner {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    streaming: true,

    async *run(opts: SubagentRunOptions): AsyncIterable<ChatEvent> {
      const cliPath = await resolveCliPath(host);
      if (!cliPath) {
        host.logger.error('claude-code: CLI not found', { hint: CLAUDE_INSTALL_HINT });
        yield {
          type: 'error',
          message: `Claude Code CLI not found. ${CLAUDE_INSTALL_HINT}`,
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }

      const envOverrides = (opts as ExtendedRunOptions).env;
      const env = scrubEnv(process.env, envOverrides);
      host.logger.info('claude-code: spawning', { cliPath, cwd: opts.workspaceRoot });

      // `--print --output-format=stream-json` requires `--verbose` on the
      // Claude Code CLI (>=2.x); without it the CLI exits with an error before
      // emitting any JSON.
      const invocation = buildSpawnInvocation(cliPath, [
        '--output-format',
        'stream-json',
        '--verbose',
        '--print',
        opts.task,
      ]);
      const child = spawn(invocation.command, invocation.args, {
        cwd: opts.workspaceRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
      });
      const childStdout = child.stdout;
      const childStderr = child.stderr;
      const childStdin = child.stdin;
      if (!childStdout || !childStderr) {
        void treeKill(child);
        host.logger.error('claude-code: child stdio unavailable');
        yield {
          type: 'error',
          message: 'Claude Code CLI child process is missing stdio pipes.',
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }
      childStdin?.end();

      const state = createTranslatorState();
      const stdoutBuf = new NdjsonBuffer();
      const stderrChunks: string[] = [];
      const pendingEvents: ChatEvent[] = [];
      let resolveWait: (() => void) | null = null;
      let closed = false;
      let spawnError: Error | null = null;
      let budgetExceeded = false;
      let aborted = false;

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

      const onAbort = (): void => {
        aborted = true;
        host.logger.warn('claude-code: abort signal received, killing process tree');
        void treeKill(child);
        wake();
      };
      const signal = opts.signal;
      if (signal) {
        if (signal.aborted) {
          aborted = true;
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
          host.logger.warn('claude-code: wall-time budget exceeded, killing process tree', {
            maxWallTimeMs,
          });
          void treeKill(child);
          wake();
        }, maxWallTimeMs);
        budgetTimer.unref?.();
      }

      const handleLine = (line: string): void => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          host.logger.warn('claude-code: malformed NDJSON line', { line, err: String(err) });
          return;
        }
        const events = translateClaudeJson(parsed, state, host.logger);
        for (const evt of events) pendingEvents.push(evt);
      };

      childStdout.setEncoding('utf8');
      childStdout.on('data', (chunk: string) => {
        const lines = stdoutBuf.push(stripAnsi(chunk));
        for (const line of lines) handleLine(line);
        wake();
      });
      childStdout.on('error', (err) => {
        host.logger.warn('claude-code: stdout stream error', { err: String(err) });
      });

      childStderr.setEncoding('utf8');
      childStderr.on('data', (chunk: string) => {
        stderrChunks.push(stripAnsi(chunk));
      });
      childStderr.on('error', (err) => {
        host.logger.warn('claude-code: stderr stream error', { err: String(err) });
      });

      if (childStdin) {
        childStdin.on('error', (err) => {
          host.logger.warn('claude-code: stdin stream error', { err: String(err) });
        });
      }

      child.on('error', (err) => {
        spawnError = err;
        host.logger.error('claude-code: spawn error', { err: String(err) });
        wake();
      });

      let exitCode: number | null = null;
      child.on('close', (code) => {
        const trailing = stdoutBuf.flush();
        for (const line of trailing) handleLine(line);
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
        if (!state.resultEmitted) {
          yield {
            type: 'error',
            message: `Claude Code CLI failed to start: ${finalSpawnError.message}`,
            retryable: false,
          };
          yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
          yield { type: 'done', stopReason: 'error' };
        }
        return;
      }

      if (aborted && !state.resultEmitted) {
        if (!state.usageEmitted) yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'cancelled' };
        return;
      }

      if (budgetExceeded && !state.resultEmitted) {
        yield {
          type: 'error',
          message: `Claude Code CLI killed: wall-time budget (${maxWallTimeMs}ms) exceeded.`,
          retryable: false,
        };
        if (!state.usageEmitted) yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'budget_exceeded' };
        return;
      }

      if (!state.resultEmitted) {
        const stderr = stderrChunks.join('').trim();
        if (exitCode !== 0) {
          host.logger.warn('claude-code: CLI exited non-zero without result event', {
            exitCode,
            stderr,
          });
          yield {
            type: 'error',
            message:
              stderr.length > 0 ? stderr : `Claude Code CLI exited with code ${exitCode ?? 'null'}`,
            retryable: false,
          };
        }
        if (!state.usageEmitted) {
          yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        }
        yield {
          type: 'done',
          stopReason: exitCode === 0 ? 'end_turn' : 'error',
        };
      }
    },

    async checkInstalled(): Promise<SubagentRunnerInstallCheck> {
      const configured = await host.getSetting<string>('claudeCliPath');
      const cliPath = configured?.trim() ?? (await autoDetect()) ?? undefined;
      return checkInstalled(cliPath);
    },
  };
}
