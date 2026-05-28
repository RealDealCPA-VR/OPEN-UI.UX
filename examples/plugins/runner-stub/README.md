# runner-stub

A reference plugin that ships a fake external agent runner via the OpenCodex
plugin SDK. It exists to demonstrate the `SubagentRunner` contribution point
end-to-end without depending on a third-party CLI being installed on the
developer's machine.

## What this is

OpenCodex ships built-in runners for Claude Code, OpenCode, and Aider. Any
plugin can contribute additional runners by declaring them in
`opencodex.plugin.json` under `contributions.runners` and registering a
`SubagentRunner` implementation in the plugin's `activate(host)` callback.

This plugin does exactly that, but with a minimal stub:

- The manifest declares one runner (`runner-stub`) and the `agent.runner`
  permission.
- `src/index.ts` calls `host.registerRunner(stubRunner)` during activation.
- `src/runner.ts` implements `SubagentRunner` with an `async function*` that
  echoes the task back as a single `text_delta`, emits a zero-token `usage`
  event, then yields a terminal `done` event with `stopReason: 'end_turn'`.

## Why it exists

It's the smallest possible thing you can copy as a starting point for a real
adapter. Reading the source should answer:

- Where does runner registration happen? (`src/index.ts`, in `activate`)
- What's the shape of a `run()` iterable? (a `ChatEvent` async iterable)
- How do I report installation state? (`checkInstalled?(): InstallCheck`)

## What a real adapter does differently

The stub takes shortcuts that production adapters cannot:

1. **Spawn a real subprocess.** Use `execa` or `child_process.spawn` to launch
   the external CLI (e.g. `claude`, `aider`, your own harness), pass the user's
   task on stdin or via CLI args, and stream stdout/stderr back. The stub just
   echoes the task string.
2. **Parse the CLI's output into `ChatEvent`s.** Real CLIs emit a mix of
   assistant text, tool calls, tool results, and usage stats — often as JSON
   lines or a custom framing. The adapter must translate those into the
   normalized `ChatEvent` stream so OpenCodex's UI, run-registry, and
   `collectSubagentResult` all keep working. The stub emits one hand-written
   `text_delta`.
3. **Handle abort cleanly.** When `opts.signal.aborted` flips true mid-run, the
   adapter must kill the spawned process (`child.kill('SIGTERM')`), drain any
   pending output, and emit a terminal `done` event so the consumer's
   `for await` loop exits. The stub only checks the signal once at the top.

A production-grade adapter also needs:

- A real `checkInstalled()` that probes for the CLI binary, parses
  `--version`, and returns a useful hint on failure (see
  `packages/runner-claude-code/src/check-installed.ts` for the pattern).
- Token accounting in the `usage` event so the cost/usage UI is accurate.
- Workspace-root respect: `opts.workspaceRoot` is the cwd the user expects the
  subprocess to operate in.

## Where to learn more

The long-form runner-authoring guide lives at `docs/runner-authoring.md` in
the OpenCodex repo. The built-in adapters under `packages/runner-*` are the
best worked examples once you've internalized this stub.

## Installing during development

Point OpenCodex at this directory via Settings → Plugins → Install from
folder, then pick "Stub runner" from the runner dropdown when launching a
task. You should see "stub received task: ..." in the run output.
