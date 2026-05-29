# OpenCodex docs index

Long-form developer-facing documentation. The user-facing manual lives at the repo root in [`MANUAL.md`](../MANUAL.md); the Nextra-rendered version of these files lives under [`website/pages/`](../website/pages/).

## Architecture and concepts

- [architecture.md](./architecture.md) — Electron process model, package layout, `LLMProvider` and `SubagentRunner` contracts, how the agent loop / approval / audit pipeline fit together.
- [positioning.md](./positioning.md) — what OpenCodex is and is not. Why local-first and provider-agnostic are non-negotiable.

## Authoring guides

- [provider-authoring.md](./provider-authoring.md) — implement the `LLMProvider` interface for a new LLM API.
- [runner-authoring.md](./runner-authoring.md) — implement the `SubagentRunner` interface for a new agent harness (CLI or in-process).
- [plugin-authoring.md](./plugin-authoring.md) — ship a plugin that contributes tools, providers, runners, slash commands, or UI panels.
- [mcp-integration.md](./mcp-integration.md) — how MCP tools / resources / prompts are surfaced through OpenCodex's tool registry.

## Security

- [security-model.md](./security-model.md) — sandboxes, permission tiers, approval modes, key storage, audit log.
- [local-only-threat-model.md](./local-only-threat-model.md) — what "local-only mode" guarantees (and what it doesn't), the network allowlist, the loopback-scheduler webhook listener.
- [voice-privacy.md](./voice-privacy.md) — local-only voice / dictation: where audio is captured, why there is no cloud STT in v1, and how the transcript reaches the composer without ever leaving the machine.
- [plugin-signing.md](./plugin-signing.md) — how plugin signatures are produced, distributed, and verified. The desktop app refuses to load unsigned plugins by default.
- [plugin-registry.md](./plugin-registry.md) — the plugin registry JSON schema and the "Browse community plugins" UX.
- [release-signing.md](./release-signing.md) — macOS notarization + Windows Authenticode signing, the CI matrix, and the credentials each platform needs.
