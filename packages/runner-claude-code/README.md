# @opencodex/runner-claude-code

First-party OpenCodex plugin that runs subagents through the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI.

## Install

Ships with OpenCodex. Enable it from the **Plugins** panel in the desktop app.

## Prerequisite

The Claude Code CLI must be installed and reachable on `PATH`:

```sh
npm install -g @anthropic-ai/claude-code
```

The runner auto-detects the binary with `which claude` (POSIX) or `where.exe claude` (Windows).

## Settings

| Key             | Type   | Default     | Description                               |
| --------------- | ------ | ----------- | ----------------------------------------- |
| `claudeCliPath` | string | auto-detect | Absolute path to the `claude` executable. |

## Event mapping

The runner translates Claude Code's `--output-format stream-json` NDJSON into OpenCodex `ChatEvent`s:

| Claude stream-json            | OpenCodex `ChatEvent` |
| ----------------------------- | --------------------- |
| `assistant.content[text]`     | `text_delta`          |
| `assistant.content[tool_use]` | `tool_call`           |
| `user.content[tool_result]`   | `tool_result`         |
| `result`                      | `usage` + `done`      |

## License

MIT
