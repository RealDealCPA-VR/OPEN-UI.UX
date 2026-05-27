import { spawn } from 'node:child_process';
import {
  treeKill,
  type ChatEvent,
  type SubagentRunOptions,
  type SubagentRunner,
  type SubagentRunnerInstallCheck,
} from '@opencodex/core';
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
  const configured = await host.getSetting<string>('aiderCliPath');
  if (configured && configured.trim().length > 0) return configured.trim();
  return autoDetect();
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

      const env = scrubEnv(process.env);
      host.logger.info('aider: spawning', { cliPath, cwd: opts.workspaceRoot });

      const child = spawn(cliPath, ['--yes', '--message', opts.task, '--map-tokens', '0'], {
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

      const onAbort = (): void => {
        host.logger.warn('aider: abort signal received, killing process tree');
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

      const stdoutBuf = new LineBuffer();
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

      const emitLine = (line: string): void => {
        if (line.length === 0) return;
        pendingEvents.push({ type: 'text_delta', delta: `${line}\n` });
      };

      childStdout.setEncoding('utf8');
      childStdout.on('data', (chunk: string) => {
        const lines = stdoutBuf.push(chunk);
        for (const line of lines) emitLine(line);
        wake();
      });

      childStderr.setEncoding('utf8');
      childStderr.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
      });

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
        if (!closed) treeKill(child);
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
