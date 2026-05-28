import type {
  ChatEvent,
  SubagentRunOptions,
  SubagentRunner,
  SubagentRunnerInstallCheck,
} from '@opencodex/core';

// This stub demonstrates the *shape* of a SubagentRunner without spawning any
// real CLI. It echoes the task back as a text_delta, then emits a usage and a
// done event. A production adapter (claude-code, opencode, aider, ...) replaces
// the body of `run()` with a child_process.spawn call plus stdout parsing.

async function* runStub(opts: SubagentRunOptions): AsyncIterable<ChatEvent> {
  // In a real adapter, you'd spawn the external CLI here with execa or
  // child_process.spawn, pass opts.task on stdin or as an arg, and stream
  // its stdout into ChatEvents.

  // Honor abort up-front: if the caller already cancelled before we started,
  // emit a terminal done event with stopReason 'error' so the consumer's
  // `for await` loop exits cleanly.
  if (opts.signal?.aborted) {
    yield { type: 'done', stopReason: 'error' };
    return;
  }

  // Echo the task back so the run pipeline sees non-empty output. In a real
  // adapter, this is where you'd forward parsed assistant text from the CLI.
  yield { type: 'text_delta', delta: `stub received task: ${opts.task}` };

  // Real adapters emit a usage event so token accounting works. The stub has
  // no token visibility, so we report zeros — `collectSubagentResult` treats
  // missing usage the same way.
  yield { type: 'usage', inputTokens: 0, outputTokens: 0 };

  // Every runner MUST emit a terminal `done` event. `collectSubagentResult`
  // uses it to derive SubagentStopReason and to know the stream is over.
  yield { type: 'done', stopReason: 'end_turn' };
}

async function checkInstalledStub(): Promise<SubagentRunnerInstallCheck> {
  // Real adapters shell out to the underlying CLI (e.g. `claude --version`)
  // and return `{ ok: false, hint: '...' }` when missing or timed out. The
  // stub has no external dependency, so it's always installed.
  return { ok: true };
}

export const stubRunner: SubagentRunner = {
  id: 'runner-stub',
  displayName: 'Stub runner',
  streaming: true,
  run: runStub,
  checkInstalled: checkInstalledStub,
};
