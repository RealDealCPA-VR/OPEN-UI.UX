# @opencodex/runner-aider

First-party OpenCodex plugin that runs subagents through the [Aider](https://aider.chat) CLI in non-interactive mode.

## Install

Ships with OpenCodex. Enable it from the **Plugins** panel in the desktop app.

## Prerequisite

The Aider CLI must be installed and reachable on `PATH`:

```sh
python -m pip install aider-chat
```

See https://aider.chat/docs/install.html for alternative install methods.

The runner auto-detects the binary with `which aider` (POSIX) or `where.exe aider` (Windows).

## Settings

| Key            | Type   | Default     | Description                              |
| -------------- | ------ | ----------- | ---------------------------------------- |
| `aiderCliPath` | string | auto-detect | Absolute path to the `aider` executable. |

## Pinned invocation

```sh
aider --yes --message "<task>" --map-tokens 0
```

- `--yes` auto-confirms file edits (the runner relies on OpenCodex's worktree
  for safety, so unattended apply is the desired mode here).
- `--message` makes Aider run one batch turn against the task and exit.
- `--map-tokens 0` disables Aider's repo-map injection because OpenCodex
  manages its own context.

## Event mapping

Aider emits human-readable stdout, not structured JSON. Aider itself runs with
`--no-stream` (no token-by-token cursor), but the runner relays each stdout
line as a separate `text_delta` as it arrives, so the `ChatEvent` iterator is
streaming in the contract sense. The runner therefore sets `streaming: true` in
the manifest, and the conversation transcript captures Aider's output verbatim.

| Aider stdout / process state | OpenCodex `ChatEvent`                     |
| ---------------------------- | ----------------------------------------- |
| each stdout line             | `text_delta` (line + `\n`)                |
| process close, exit code 0   | `usage`(0,0) + `done` (`end_turn`)        |
| process close, non-zero exit | `error` + `usage`(0,0) + `done` (`error`) |
| stderr (collected)           | folded into the error message             |

Aider does not expose token counts in headless mode, so the runner emits a
single `usage` event with zero tokens before `done`.

## Auditing future Aider releases

When pinning a new Aider version:

1. Run `aider --help` against the new binary; confirm `--yes`, `--message`,
   and `--map-tokens` still exist.
2. If Aider grows a `--json` mode in the future, swap the line buffer for a
   proper NDJSON parser and update the table above.
3. Re-run `pnpm --filter @opencodex/runner-aider test`.

## License

MIT
