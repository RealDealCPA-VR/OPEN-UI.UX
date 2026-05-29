import { spawn } from 'node:child_process';
import {
  type ChatEvent,
  type SubagentRunOptions,
  type SubagentRunner,
  type SubagentRunnerInstallCheck,
} from '@opencodex/core';
import { treeKill } from '@opencodex/core/process/tree-kill';
import type { PluginHost } from '@opencodex/plugin-sdk';
import {
  NdjsonBuffer,
  createTranslatorState,
  fallbackTextDelta,
  translateOpenCodeJson,
} from './event-translator';
import { OPENCODE_INSTALL_HINT, autoDetect, checkInstalled } from './check-installed';

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
];

function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEEP) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function resolveCliPath(host: PluginHost): Promise<string | null> {
  const configured = await host.getSetting<string>('opencodeCliPath');
  if (configured && configured.trim().length > 0) return configured.trim();
  return autoDetect();
}

export function createOpenCodeRunner(host: PluginHost): SubagentRunner {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    streaming: true,

    async *run(opts: SubagentRunOptions): AsyncIterable<ChatEvent> {
      const cliPath = await resolveCliPath(host);
      if (!cliPath) {
        host.logger.error('opencode: CLI not found', { hint: OPENCODE_INSTALL_HINT });
        yield {
          type: 'error',
          message: `OpenCode CLI not found. ${OPENCODE_INSTALL_HINT}`,
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }

      const env = scrubEnv(process.env);
      host.logger.info('opencode: spawning', { cliPath, cwd: opts.workspaceRoot });

      const child = spawn(cliPath, ['--headless', '--message', opts.task], {
        cwd: opts.workspaceRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      const childStdout = child.stdout;
      const childStderr = child.stderr;
      if (!childStdout || !childStderr) {
        treeKill(child);
        host.logger.error('opencode: child stdio unavailable');
        yield {
          type: 'error',
          message: 'OpenCode CLI child process is missing stdio pipes.',
          retryable: false,
        };
        yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
        yield { type: 'done', stopReason: 'error' };
        return;
      }

      const onAbort = (): void => {
        host.logger.warn('opencode: abort signal received, killing process tree');
        treeKill(child);
      };
      const signal = opts.signal;
      if (signal) {
        if (signal.aborted) {
          treeKill(child);
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const state = createTranslatorState();
      const stdoutBuf = new NdjsonBuffer();
      const stderrChunks: string[] = [];
      const pendingEvents: ChatEvent[] = [];
      let resolveWait: (() => void) | null = null;
      let closed = false;
      let spawnError: Error | null = null;

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

      const handleLine = (line: string): void => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          const fallback = fallbackTextDelta(line);
          if (fallback) pendingEvents.push(fallback);
          return;
        }
        const events = translateOpenCodeJson(parsed, state, host.logger);
        for (const evt of events) pendingEvents.push(evt);
      };

      childStdout.setEncoding('utf8');
      childStdout.on('data', (chunk: string) => {
        const lines = stdoutBuf.push(chunk);
        for (const line of lines) handleLine(line);
        wake();
      });

      childStderr.setEncoding('utf8');
      childStderr.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
      });

      child.on('error', (err) => {
        spawnError = err;
        host.logger.error('opencode: spawn error', { err: String(err) });
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
        if (!closed) treeKill(child);
      }

      const finalSpawnError = spawnError as Error | null;
      if (finalSpawnError) {
        if (!state.resultEmitted) {
          yield {
            type: 'error',
            message: `OpenCode CLI failed to start: ${finalSpawnError.message}`,
            retryable: false,
          };
          yield { type: 'usage', inputTokens: 0, outputTokens: 0 };
          yield { type: 'done', stopReason: 'error' };
        }
        return;
      }

      if (!state.resultEmitted) {
        const stderr = stderrChunks.join('').trim();
        if (exitCode !== 0) {
          host.logger.warn('opencode: CLI exited non-zero without done event', {
            exitCode,
            stderr,
          });
          yield {
            type: 'error',
            message:
              stderr.length > 0 ? stderr : `OpenCode CLI exited with code ${exitCode ?? 'null'}`,
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
      const configured = await host.getSetting<string>('opencodeCliPath');
      const cliPath = configured?.trim() ?? (await autoDetect()) ?? undefined;
      return checkInstalled(cliPath);
    },
  };
}
