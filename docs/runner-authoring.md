# Runner Authoring Guide

A "runner" in OpenCodex is anything that implements `SubagentRunner`. The built-in runner runs in-process through whichever `LLMProvider` you have configured; first-party adapters wrap Claude Code, OpenCode, and Aider; third parties ship their own through the plugin SDK (see [plugin-authoring.md](./plugin-authoring.md)).

This guide is the contract. Match it and OpenCodex's chat composer, scheduled tasks editor, audit log, and diff-review flow treat your runner as a first-class citizen.

## How runners relate to providers

A `LLMProvider` is the thinnest possible LLM client: one model, one streaming `chat()` call, one `embed()` call. A `SubagentRunner` sits one level up — it owns a whole agentic loop end-to-end: prompting, tool calling, file editing, and approval. The internal runner uses a provider under the hood; an external runner (Claude Code, OpenCode, Aider, your plugin) spawns a child CLI that brings its own provider, prompts, and tools.

In short: providers stream tokens; runners run tasks.

## The `SubagentRunner` interface

```ts
interface SubagentRunner {
  readonly id: string; // unique across all runners
  readonly displayName: string; // shown in the picker
  readonly streaming: boolean; // false → UI shows a spinner only
  checkInstalled(): Promise<{
    installed: boolean;
    version?: string;
    detail?: string; // shown when installed=false
    hintUrl?: string; // optional install link
  }>;
  run(options: SubagentRunOptions): AsyncIterable<ChatEvent>;
}
```

`SubagentRunOptions` carries the prompt, the workspace `cwd`, the worktree path, any `allowedTools` advisory whitelist, and an `AbortSignal`.

## `ChatEvent` semantics

Whatever the underlying CLI streams (NDJSON, SSE, plain stdout), the agent loop only understands `ChatEvent`. The required terminal event is `done`. Conventionally, `usage` is emitted just before `done` so the cost meter has a final tally before the run is marked complete.

| `type`        | Semantics                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `text_delta`  | Incremental assistant text. Yield as bytes arrive — do not buffer the whole turn.                                                          |
| `tool_call`   | A complete tool invocation: `{ id, name, input }`. The `id` must be unique within the run; reuse it on the corresponding `tool_result`.    |
| `tool_result` | The CLI's observation of a tool call: `{ id, output, isError? }`. Mirror the CLI's success/failure flag into `isError`.                    |
| `usage`       | `{ inputTokens, outputTokens, cachedInputTokens? }`. Recommended to emit once near the end.                                                |
| `done`        | **Required** terminal event. `stopReason` is one of `stop`, `tool_use`, `max_tokens`, `cancelled`, `runner_error`, `runner_not_installed`. |

If your CLI does not surface tool calls separately (Aider, for example, just writes diffs to disk), skip `tool_call` / `tool_result` entirely and emit one final `text_delta` with a human-readable summary plus `done`.

## `checkInstalled` contract

Called by Settings → Runners (to drive the status pill) and at the top of every `run()` (to short-circuit with `stopReason: 'runner_not_installed'` if the CLI vanished). Return shape:

```ts
{
  installed: boolean;
  version?: string;   // "0.42.1" or "git-abc1234"
  detail?: string;    // shown when installed=false
  hintUrl?: string;   // optional link to install instructions
}
```

Keep the probe under a few seconds — the Settings panel calls it synchronously when the user opens the page. Fallback search paths: probe `PATH` first via `execFile(this.cliPath, ['--version'])`, then known per-platform install locations (`~/.local/bin`, `/opt/homebrew/bin`, `%APPDATA%\npm`), then the user-configured `cliPath` override.

## Abort lifecycle

Every `run()` receives `opts.signal`. When the user cancels from the chat header or the host quits, the signal aborts. Wire it to the child process via the shared `treeKill` helper exported from `@opencodex/core`:

```ts
import { treeKill } from '@opencodex/core';

async function* run(options: SubagentRunOptions) {
  const child = spawn(this.cliPath, ['--prompt', options.prompt], {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const cleanup = () => treeKill(child.pid).catch(() => {});
  options.signal.addEventListener('abort', cleanup, { once: true });

  try {
    for await (const event of parseStream(child.stdout)) {
      yield event;
    }
  } finally {
    cleanup();
  }
}
```

`treeKill` SIGTERMs the whole process tree (Aider, for instance, spawns its own `git` children). Don't reinvent it — the host expects this cleanup path on shutdown.

## Plugin wiring

Your plugin manifest declares the runner contribution and the `agent.runner` permission:

```json
{
  "name": "my-runner",
  "version": "0.0.0",
  "displayName": "My Runner",
  "entry": "dist/index.js",
  "engines": { "opencodex": "^0.1.0" },
  "permissions": ["agent.runner"],
  "contributions": {
    "runners": ["my-runner"]
  }
}
```

At activation, call `host.registerRunner(myRunner)`:

```ts
import { definePlugin } from '@opencodex/plugin-sdk';
import { myRunner } from './my-runner.js';

export default definePlugin({
  async activate(host) {
    host.registerRunner(myRunner);
  },
});
```

Without the `agent.runner` permission, `host.registerRunner` throws at activation.

## Worktree caveat

External runners always run inside a git worktree. OpenCodex creates a fresh worktree under `<workspace>/.opencodex/worktrees/<run-id>` on branch `opencodex/subagent/<run-id>` before invoking your `run()`, sets that as the CLI's `cwd`, and queues the resulting diff for review when the run finishes.

If the workspace is not a git repo, OpenCodex refuses to start the run and emits `done` with `stopReason: 'runner_error'`. There is no fallback to writing directly into a non-git workspace — that is the internal runner's job. Design your adapter assuming `cwd` is always a worktree on a throwaway branch.

## Example

See [`examples/plugins/runner-stub/`](../examples/plugins/runner-stub/) for a minimal end-to-end runner plugin — manifest, `checkInstalled`, an NDJSON parser, abort wiring, and a passing test. Copy it, rename, and wire to your own CLI.

## Contributing friendly-error patterns

When an external CLI fails, OpenCodex maps the raw stderr to a typed `RunnerFriendlyError` so the spawn modal and run drawer can show a one-line fix instead of a wall of stack trace. The mapping lives in [`apps/desktop/src/main/agent/runner-friendly-errors.ts`](../apps/desktop/src/main/agent/runner-friendly-errors.ts) and has two halves:

1. A list of common regex patterns shared across runners, each tagged with a `kind` (`auth`, `model-not-found`, `rate-limit`, `network`).
2. A per-runner dictionary of `suggestedFix` strings keyed by runner id and kind.

The shape:

```ts
const PER_RUNNER_FIXES: Record<string, Partial<Record<RunnerFriendlyErrorKind, string>>> = {
  'claude-code': {
    auth: "Run 'claude login' in your terminal.",
    'model-not-found':
      'Check the model name with `claude --help` or pick a different model in OpenCodex.',
    'rate-limit': 'Wait a minute, then try again. Anthropic enforces per-minute limits.',
    network: 'Check your network connection and any proxy settings.',
  },
  // ...
};
```

Plugin runner authors are encouraged to submit additions for their runner id. The patch is usually one new entry in `PER_RUNNER_FIXES` keyed by your runner's id, plus any runner-specific regex patterns that the shared list does not already cover. A new pattern entry looks like:

```ts
{ pattern: /your specific stderr signature/i, kind: 'auth', message: 'Short human-readable summary.' },
```

Keep the suggested fix to a single sentence and prefer pointing at a command the user can paste. The renderer renders the fix verbatim, so phrase it so it reads well next to the runner name.

## Where to ask for help

Open an issue using the runner-authoring template — see the link in the GitHub issues config once the placeholders in [`PLACEHOLDERS.md`](../PLACEHOLDERS.md) are filled.
