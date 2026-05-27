import { collectSubagentResult, type SubagentRunOptions } from '@opencodex/core';
import { workerStartMessageSchema, type WorkerOutboundMessage } from './worker-protocol';
import { runnerRegistry } from './runner-registry-instance';
import { internalRunner } from './subagent';

interface ParentPortLike {
  on(event: 'message', listener: (msg: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
}

function getParentPort(): ParentPortLike {
  const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (!port) {
    throw new Error(
      'worker-entry: process.parentPort is not available (not an Electron utilityProcess)',
    );
  }
  return port;
}

function post(msg: WorkerOutboundMessage): void {
  getParentPort().postMessage(msg);
}

// The worker is short-lived per subagent run; ensure the built-in runner is
// available in the utility process before we look up a runnerId.
if (!runnerRegistry.has(internalRunner.id)) {
  try {
    runnerRegistry.register(internalRunner);
  } catch {
    // already registered concurrently — fine
  }
}

async function handleStart(rawMessage: unknown): Promise<void> {
  const parsed = workerStartMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    post({ kind: 'error', message: `invalid start payload: ${parsed.error.message}` });
    return;
  }
  const start = parsed.data;

  try {
    const runner = runnerRegistry.get(start.runnerId);
    if (!runner) {
      post({
        kind: 'result',
        text: '',
        toolEvents: [],
        inputTokens: 0,
        outputTokens: 0,
        stopReason: 'runner_not_installed',
        error: `Unknown runner: ${start.runnerId}`,
        iterations: 0,
        runnerId: start.runnerId,
      });
      return;
    }

    const runOpts: SubagentRunOptions = {
      task: start.task,
      providerId: start.providerId,
      modelId: start.modelId,
      workspaceRoot: start.workspaceRoot,
      ...(start.allowedToolNames ? { allowedToolNames: start.allowedToolNames } : {}),
      ...(start.budget ? { budget: start.budget } : {}),
      ...(start.systemPrompt ? { systemPrompt: start.systemPrompt } : {}),
    };

    const iter = runner.run(runOpts);
    const result = await collectSubagentResult(iter);

    post({
      kind: 'result',
      text: result.text,
      toolEvents: result.toolEvents,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stopReason: result.stopReason,
      ...(result.error ? { error: result.error } : {}),
      iterations: result.iterations,
      runnerId: start.runnerId,
    });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

const port = getParentPort();
port.on('message', (msg) => {
  void handleStart(msg.data);
});
post({ kind: 'ready' });
