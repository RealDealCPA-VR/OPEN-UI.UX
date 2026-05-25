import { workerStartMessageSchema, type WorkerOutboundMessage } from './worker-protocol';
import { runSubagent } from './subagent';

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

async function handleStart(rawMessage: unknown): Promise<void> {
  const parsed = workerStartMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    post({ kind: 'error', message: `invalid start payload: ${parsed.error.message}` });
    return;
  }
  const start = parsed.data;

  try {
    const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
      import('../chat/provider-builder'),
      import('../tools/registry'),
    ]);
    const provider = await buildProviderForId(start.providerId);
    const result = await runSubagent({
      task: start.task,
      provider,
      modelId: start.modelId,
      toolRegistry: getToolRegistry(),
      ...(start.allowedToolNames ? { allowedToolNames: start.allowedToolNames } : {}),
      workspaceRoot: start.workspaceRoot,
      ...(start.systemPrompt ? { systemPrompt: start.systemPrompt } : {}),
      ...(start.budget ? { budget: start.budget } : {}),
    });
    post({
      kind: 'result',
      text: result.text,
      toolEvents: result.toolEvents,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      stopReason: result.stopReason,
      ...(result.error ? { error: result.error } : {}),
      iterations: result.iterations,
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
