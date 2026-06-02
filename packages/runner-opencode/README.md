# @opencodex/runner-opencode

First-party OpenCodex plugin that runs subagents through the [OpenCode](https://github.com/opencode-ai/opencode) CLI in headless mode.

## Install

Ships with OpenCodex. Enable it from the **Plugins** panel in the desktop app.

## Prerequisite

The OpenCode CLI must be installed and reachable on `PATH`. See the upstream
project for the current install command:

- https://github.com/opencode-ai/opencode

The runner auto-detects the binary with `which opencode` (POSIX) or `where.exe opencode` (Windows).

## Settings

| Key               | Type   | Default     | Description                                 |
| ----------------- | ------ | ----------- | ------------------------------------------- |
| `opencodeCliPath` | string | auto-detect | Absolute path to the `opencode` executable. |

## Pinned invocation

The runner currently invokes:

```sh
opencode run "<task>" [--model <id>]
```

The legacy `--headless --message` flags no longer exist in the OpenCode CLI and
have been removed from the runner; the `run` subcommand is the current
non-interactive entry point. OpenCode's flag set has changed across releases. If
the version you have installed uses a different flag set, set the
`opencodeCliPath` setting and/or open an issue so we can extend the runner with
a version-aware flag matrix.

Peer-dependency pin in this package's `package.json`: `opencode >=0.1.0` (optional).

## Event mapping (assumed)

The runner parses stdout as NDJSON (one JSON object per line) at
`src/runner.ts`. Note that `opencode run` does **not** pass an explicit
output-format flag, so the build you have installed must emit NDJSON on stdout
for the transcript to be captured — any line that is not valid JSON is logged
and dropped (`src/runner.ts` `handleLine`), yielding an empty transcript. If a
newer release requires a flag (e.g. `--print`, `--json`, `--output-format`) to
produce machine-readable output, add it to the `['run', opts.task]` argv in
`src/runner.ts`.

The mapping below is the runner's **assumed** translation:

| OpenCode stream-json             | OpenCodex `ChatEvent`   |
| -------------------------------- | ----------------------- |
| `{type:'text', text}`            | `text_delta`            |
| `{type:'tool', id, name, input}` | `tool_call`             |
| `{type:'tool_result', id, ...}`  | `tool_result`           |
| `{type:'done', usage?, error?}`  | `usage` + `done`        |
| unstructured stdout line         | `text_delta` (fallback) |

## Auditing future OpenCode releases

When pinning a new OpenCode version:

1. Run `opencode run --help` against the new binary; confirm the `run` subcommand and any output-format flag.
2. Capture a sample run: `opencode run "say hi" 2>/dev/null | head -20`.
3. If the JSON shape changed, update `src/event-translator.ts` and the table
   above, and bump the peer-dependency range in `package.json`.
4. Re-run `pnpm --filter @opencodex/runner-opencode test`.

## License

MIT
