import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger';
import type { SubagentResult, SubagentToolEvent } from './subagent';
import {
  workerOutboundMessageSchema,
  type WorkerEventMessage,
  type WorkerOutboundMessage,
  type WorkerStartMessage,
} from './worker-protocol';

export interface RunSubagentInWorkerOptions {
  task: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
  allowedToolNames?: readonly string[];
  budget?: {
    maxTokens?: number;
    maxToolIterations?: number;
    maxWallTimeMs?: number;
  };
  systemPrompt?: string;
  signal?: AbortSignal;
}

interface UtilityProcessLike {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (msg: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}

interface ElectronUtilityProcessModule {
  utilityProcess: {
    fork(modulePath: string, args?: readonly string[], options?: object): UtilityProcessLike;
  };
}

let cachedElectron: ElectronUtilityProcessModule | null | undefined;

async function loadElectron(): Promise<ElectronUtilityProcessModule | null> {
  if (cachedElectron !== undefined) return cachedElectron;
  try {
    const mod = (await import('electron')) as unknown as ElectronUtilityProcessModule;
    if (mod && typeof mod.utilityProcess?.fork === 'function') {
      cachedElectron = mod;
      return mod;
    }
  } catch {
    // electron not available (e.g. running under vitest)
  }
  cachedElectron = null;
  return null;
}

export function isUtilityProcessAvailable(): Promise<boolean> {
  return loadElectron().then((m) => m !== null);
}

function toToolEvent(e: WorkerEventMessage['event']): SubagentToolEvent {
  return {
    name: e.name,
    input: e.input,
    output: e.output,
    isError: e.isError,
    durationMs: e.durationMs,
  };
}

function resolveWorkerEntryPath(): string {
  // worker-host.ts is bundled into out/main/index.js (alongside the main process bundle).
  // The worker-entry chunk is emitted to out/main/agent/worker-entry.js by electron.vite.config.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'agent', 'worker-entry.js');
}

export async function runSubagentInWorker(
  opts: RunSubagentInWorkerOptions,
): Promise<SubagentResult> {
  const electron = await loadElectron();
  if (!electron) {
    throw new Error('runSubagentInWorker: electron utilityProcess is not available');
  }

  const modulePath = resolveWorkerEntryPath();
  logger.info({ modulePath, providerId: opts.providerId }, 'forking subagent worker');
  const child = electron.utilityProcess.fork(modulePath, [], {
    serviceName: 'opencodex-subagent',
    stdio: 'inherit',
  });

  const toolEvents: SubagentToolEvent[] = [];

  return new Promise<SubagentResult>((resolve, reject) => {
    let settled = false;
    let killed = false;

    const cleanup = (): void => {
      if (!killed) {
        killed = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    };

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('subagent aborted'));
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('message', (raw: unknown) => {
      const parsed = workerOutboundMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.message }, 'subagent worker sent unparseable message');
        return;
      }
      const msg: WorkerOutboundMessage = parsed.data;
      switch (msg.kind) {
        case 'ready': {
          const start: WorkerStartMessage = {
            kind: 'start',
            task: opts.task,
            providerId: opts.providerId,
            modelId: opts.modelId,
            workspaceRoot: opts.workspaceRoot,
            ...(opts.allowedToolNames
              ? { allowedToolNames: Array.from(opts.allowedToolNames) }
              : {}),
            ...(opts.budget ? { budget: opts.budget } : {}),
            ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
          };
          child.postMessage(start);
          break;
        }
        case 'event':
          toolEvents.push(toToolEvent(msg.event));
          break;
        case 'result': {
          if (settled) return;
          settled = true;
          opts.signal?.removeEventListener('abort', onAbort);
          cleanup();
          const events = msg.toolEvents.length > 0 ? msg.toolEvents.map(toToolEvent) : toolEvents;
          const merged: SubagentResult = {
            text: msg.text,
            toolEvents: events,
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens,
            stopReason: msg.stopReason,
            ...(msg.error ? { error: msg.error } : {}),
            iterations: msg.iterations,
          };
          resolve(merged);
          break;
        }
        case 'error': {
          if (settled) return;
          settled = true;
          opts.signal?.removeEventListener('abort', onAbort);
          cleanup();
          reject(new Error(msg.message));
          break;
        }
      }
    });

    child.on('exit', (code: number) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new Error(`subagent worker exited unexpectedly (code=${code})`));
    });
  });
}
