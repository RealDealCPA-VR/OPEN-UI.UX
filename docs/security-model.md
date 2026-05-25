# Security Model

OpenCodex runs untrusted model output in a privileged context (your machine, your repo, your API keys). The security model is defense-in-depth: Electron sandbox at the OS layer, Zod validation at every IPC boundary, permission tiers + approval prompts at the tool layer, scrubbed shell environment for execution, OS keychain for secrets.

## Sandboxes: main vs renderer

The renderer process runs in Chromium's sandbox with no Node integration. Created in `apps/desktop/src/main/index.ts:78`:

```ts
mainWindow = new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, '../preload/index.mjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: [...],
  },
});
```

What this buys:

- `sandbox: true` — Chromium sandbox at the OS level. The renderer can't open files, spawn processes, or read arbitrary memory.
- `contextIsolation: true` — preload script runs in a separate JS context from page scripts. Even if attacker JS executes in the renderer, it can't reach the preload's variables.
- `nodeIntegration: false` — no `require`, no `process`, no Node APIs in the renderer.

The preload script (`apps/desktop/src/preload/index.ts`) exposes a curated API surface via `contextBridge.exposeInMainWorld('opencodex', api)` (`preload/index.ts:208`). Renderer JS calls `window.opencodex.providers.list()`; preload turns that into `ipcRenderer.invoke('providers:list')`; main process Zod-validates and dispatches. **No other channel reaches main.**

## IPC contract

Every invoke handler is registered through `registerInvoke()` in `apps/desktop/src/main/ipc/registry.ts:15`. The function takes a Zod `requestSchema` and validates the payload on every call (`registry.ts:21`):

```ts
ipcMain.handle(channel, async (_event, raw: unknown) => {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ channel, issues: parsed.error.issues }, 'invalid IPC request');
    throw new Error(`invalid request for ${channel}: ${parsed.error.message}`);
  }
  return handler(parsed.data);
});
```

Representative handler registrations (search for `registerInvoke(` in any of these):

- `apps/desktop/src/main/providers/handlers.ts:37` — `providers:list` etc.
- `apps/desktop/src/main/chat/handlers.ts` — `chat:start`, `chat:cancel`, conversation CRUD.
- `apps/desktop/src/main/chat/approval-handlers.ts` — approval policy + response.
- `apps/desktop/src/main/tool-audit/handlers.ts` — audit log query/clear.
- `apps/desktop/src/main/theme/handlers.ts` — theme prefs.
- `apps/desktop/src/main/workspace/handlers.ts` — workspace switching.

The channel typing lives in `apps/desktop/src/shared/ipc-types.ts:52` (`IpcInvokeChannels`) and `:187` (`IpcEventChannels`). Renderer, preload, and main all import from the same file — TypeScript catches drift at compile time, Zod catches it at runtime.

## Permission tiers for tools

Every `Tool` declares a `permissionTier` (`packages/core/src/tool.ts:4`):

```ts
type PermissionTier = 'read' | 'write' | 'execute' | 'network';
```

Default policies (`apps/desktop/src/shared/approvals.ts:33`):

```ts
const DEFAULT_TIER_POLICIES = {
  read: 'auto',
  write: 'prompt',
  execute: 'prompt',
  network: 'prompt',
};
```

- `read` (`read_file`, `glob`, `grep`, `list_dir`) → auto-approve. Reads inside workspace are considered safe.
- `write` (`write_file`, `edit_file`) → prompt with a diff preview.
- `execute` (`run_shell`) → prompt with the command preview.
- `network` (`web_fetch`) → prompt; on top of that, the allowlist gate denies any host not in `OPENCODEX_WEB_FETCH_ALLOWLIST` before the tool even runs.

A user can override per-tier (`approvals.tierDefaults`) or per-tool (`approvals.toolOverrides`) — see `apps/desktop/src/main/chat/approvals.ts:135` (`effectivePolicy()`). Per-tool overrides win.

## Approval system

`ApprovalManager` in `apps/desktop/src/main/chat/approvals.ts:40`. Three response scopes (`apps/desktop/src/shared/approvals.ts:5`):

- `'once'` — allow/deny just this call.
- `'session'` — allow/deny for the rest of this chat stream (`streamId`). Cleared on `clearSession(streamId)` (`approvals.ts:111`) when the stream ends.
- `'always'` — write the decision into `approvals.toolOverrides[toolName]` so all future calls auto-resolve.

Flow (from `runner.ts:329`):

1. Agent emits a `tool_call`.
2. If the tool's tier ≠ `'read'`, `ApprovalManager.requestApproval()` is called.
3. The manager first checks session overrides, then policy. Auto or deny short-circuit. `prompt` broadcasts an `ApprovalRequest` to the renderer.
4. Renderer shows the approval UI; user picks decision + scope.
5. `approvals:respond` IPC → `ApprovalManager.respond()` (`approvals.ts:89`) resolves the awaiting promise.
6. Tool either runs through `ToolRegistry.execute()` or returns `Tool "X" was denied by user policy`.

**Every decision is audit-logged.** `recordToolCall()` (`apps/desktop/src/main/storage/tool-audit.ts:49`) writes a row to the `tool_calls` SQLite table with: `messageId`, `toolName`, full input JSON, full output JSON, `decision`, `isError`, `durationMs`, `created_at`. Schema in `db.ts:32` + `db.ts:64`. Decisions enumerated as `'auto' | 'prompt-allowed' | 'prompt-allowed-session' | 'prompt-allowed-always' | 'denied'` (see `runner.ts:387` `outcomeToAuditDecision`).

Retention is configurable: `settings.auditRetentionDays` (default unlimited). On boot, `purgeToolCallsOlderThan()` (`main/index.ts:118`) trims rows older than the retention window.

## Shell sandbox

`run_shell` (`packages/tools/src/run-shell.ts:60`) is the most dangerous built-in. Defenses:

- **cwd lock** — `cwd` defaults to the workspace root; if specified, it's resolved with `resolveWithinWorkspace()` (`run-shell.ts:67`) which throws `PathEscapesWorkspaceError` for any `..`-out-of-tree path.
- **env scrub** — `scrubEnv()` (`run-shell.ts:203`) builds the child's environment from a hardcoded whitelist (`DEFAULT_ENV_KEEP`, line 41): `PATH`, `HOME`, `USER`, `LANG`, system temp dirs, Windows essentials. Everything else is dropped. Users can add to the whitelist via `OPENCODEX_SHELL_ENV_KEEP` (comma-separated).
- **`OPENCODEX_SHELL_PATH` allowlist** — set this env var to override `PATH` with a curated directory list (line 214). The model can't escape it.
- **output cap** — both stdout and stderr capped at 1 MiB by default (line 38), tunable per-call up to 10 MiB. When the cap is hit, the child is killed (`tryKill`) and the result includes `truncatedStdout: true` / `truncatedStderr: true`.
- **hard timeout** — default 30s, max 600s. On timeout, the child is killed and `timedOut: true` is returned (line 121).
- **process-tree kill** — Windows uses `taskkill /F /T /PID <pid>` to kill the whole tree (line 171); POSIX uses `process.kill(-pid, 'SIGTERM')` on the process group, escalating to `SIGKILL` after a 2-second grace period (`run-shell.ts:166-200`). This matters because shells spawn subshells — a naive `child.kill()` orphans grandchildren.
- **abort propagation** — the tool's `ctx.signal` (from the agent loop's `AbortController`) wires into the same kill path.

## web_fetch

`packages/tools/src/web-fetch.ts:30`.

- **Denied by default** — the host must be in `OPENCODEX_WEB_FETCH_ALLOWLIST` (comma-separated, supports `*.example.com` wildcards). `isHostAllowed()` (`web-fetch.ts:123`) is the gate. Empty allowlist = nothing fetchable.
- **Protocol guard** — only `http:` and `https:` accepted; anything else throws (`web-fetch.ts:38`).
- **Body cap** — default 1 MiB, max 10 MiB. Stream is cancelled the instant it overflows (`readBodyCapped`, `web-fetch.ts:88`).
- **Timeout** — default 30s, max 120s.
- **Tier `'network'`** — still subject to the approval prompt on top of the allowlist.

## Key storage

API keys never live in JSON, settings, SQLite, or logs. They go through `keytar` (`apps/desktop/src/main/storage/secrets.ts:1`) — which delegates to the OS keychain:

- macOS: Keychain Access.
- Windows: Credential Manager.
- Linux: Secret Service (libsecret / gnome-keyring / KWallet).

Service name `opencodex`, account `provider:<id>:apiKey`. Helpers:

```ts
setSecret(account, value); // secrets.ts:5
getSecret(account); // secrets.ts:9
deleteSecret(account); // secrets.ts:13
listSecretAccounts(); // secrets.ts:17
```

The Pino logger is configured to never log values returned from `getSecret`. Provider builders (`apps/desktop/src/main/chat/provider-builder.ts:22`) read the key at call time and pass it straight into the provider factory's config.

## Path traversal

Any tool that touches the workspace must use `resolveWithinWorkspace()` (`packages/tools/src/path-guard.ts:13`). It:

1. Resolves the requested path relative to the workspace root.
2. Computes `path.relative(root, resolved)`.
3. Throws `PathEscapesWorkspaceError` (`path-guard.ts:3`) if the relative path starts with `..` or is absolute.

This catches `../../etc/passwd`, absolute paths, and symlink-relative tricks. Every built-in write/read tool routes through it.

## Plugin sandbox

Status: **planned for v0.1**. The SDK contracts are settled (`packages/plugin-sdk/src/`); the loader is not yet wired into `apps/desktop`.

Designed posture:

- Plugin entry module runs in a Node `vm` context with a curated global surface — no `process`, no unrestricted `require`, no direct `fs` / `net`.
- Manifest-declared `permissions[]` (see `manifest.ts:3`) gate which `PluginHost` methods actually function. A plugin without `workspace.write` cannot register a `permissionTier: 'write'` tool, and even if it tried, the host would reject the registration.
- On install the user reviews and grants permissions; revoke = remove the entry from the manifest grant set on disk, which the loader re-checks on activation.
- UI panels (when wired) render in sandboxed iframes; `postMessage` is the only bridge. No Node access in panel JS.

Fallback if VM-context isolation proves leaky: each plugin in its own Electron `utilityProcess`. The `PluginHost` surface was designed so this swap is invisible to plugin authors.

## MCP server trust boundaries

Each transport (`packages/mcp-client/src/transport.ts:3`) has a different trust shape:

- **stdio** — you spawn the binary. Trust depends on what you spawn. OpenCodex passes only the user-configured `env` (`StdioServerConfig.env` in `packages/mcp-client/src/config.ts:3`), never the parent's full environment.
- **SSE** — long-lived HTTPS connection. The server sees every tool argument you send it. Treat remote MCP servers like any third-party API.
- **HTTP (streamable)** — same trust posture as SSE; just a different framing.

In every case, **MCP tools route through the same approval gateway as built-in tools.** A malicious MCP server cannot trigger silent writes — the user still sees a prompt with the tool name + arguments before anything runs. OAuth-based auth for SSE/HTTP servers will use `keytar` (planned for v0.1) so the access token never lands in plaintext on disk.
