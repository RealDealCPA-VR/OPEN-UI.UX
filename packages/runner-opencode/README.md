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
opencode --headless --message "<task>"
```

This is the **assumed** headless invocation. OpenCode's flag set has changed
across releases. If the version you have installed uses a different flag set
(e.g. `run`, `--non-interactive`, `--print`, `--json`), set the
`opencodeCliPath` setting and/or open an issue so we can extend the runner
with a version-aware flag matrix.

Peer-dependency pin in this package's `package.json`: `opencode >=0.1.0` (optional).

## Event mapping (assumed)

OpenCode emits a JSON-event stream on stdout (one JSON object per line, NDJSON).
The mapping below is the runner's **assumed** translation. If the actual
release diverges, the runner falls back to treating each unparseable stdout
line as a `text_delta` so the plugin still works in degraded mode.

| OpenCode stream-json             | OpenCodex `ChatEvent`   |
| -------------------------------- | ----------------------- |
| `{type:'text', text}`            | `text_delta`            |
| `{type:'tool', id, name, input}` | `tool_call`             |
| `{type:'tool_result', id, ...}`  | `tool_result`           |
| `{type:'done', usage?, error?}`  | `usage` + `done`        |
| unstructured stdout line         | `text_delta` (fallback) |

## Auditing future OpenCode releases

When pinning a new OpenCode version:

1. Run `opencode --help` against the new binary; confirm the headless flag.
2. Capture a sample run: `opencode --headless --message "say hi" 2>/dev/null | head -20`.
3. If the JSON shape changed, update `src/event-translator.ts` and the table
   above, and bump the peer-dependency range in `package.json`.
4. Re-run `pnpm --filter @opencodex/runner-opencode test`.

## License

MIT
