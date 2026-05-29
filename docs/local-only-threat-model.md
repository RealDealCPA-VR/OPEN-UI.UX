# Local Only mode — threat model

OpenCodex is local-first by design: the desktop app, the embedded database, and
every workspace artifact live on your machine. Even so, every outbound HTTP(S)
request — provider API calls, the `web_fetch` tool, MCP servers, plugin code —
is a potential exfiltration channel. **Local Only mode** and the **network
allowlist** are two compositional defenses that let you prove no data leaves
your machine while you are working with a sensitive codebase.

## Goals

- **Default-deny outbound traffic** when working with a sensitive codebase.
- **Auditable**: a single switch the user can flip from the title bar, with a
  clearly-visible high-contrast pill in the title bar showing current state.
- **Composable** with the existing approval system (which gates _tool calls_,
  not raw sockets).
- **No silent failures**: blocked requests must throw a typed error
  (`LocalOnlyBlockedError`) so tools and providers surface a clear message
  in the UI.

## Non-goals

- Network sandboxing of arbitrary OS processes (e.g. `curl`, `git push`,
  `npm install`, or a `run_shell` call). This is impossible from inside the
  Electron renderer without privileged OS hooks; instead, the user must approve
  `execute`-tier tools with care.
- Blocking outbound DNS lookups themselves; the policy operates at the URL/host
  layer above DNS.
- Preventing data leaks through trusted plugins that bypass the policy by
  spawning their own subprocesses or by calling into native modules.

## Components

| Component                      | Path                                                     | Role                                                                     |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `network-policy.ts` (main)     | `apps/desktop/src/main/security/network-policy.ts`       | Pure policy: allowlist matching, Local Only check, typed errors.         |
| `network-policy.ts` (shared)   | `apps/desktop/src/shared/network-policy.ts`              | Zod schema for IPC + persisted settings.                                 |
| `handlers.ts` (main)           | `apps/desktop/src/main/security/handlers.ts`             | IPC: get / set / add / remove. Broadcasts `network:policy-changed`.      |
| `LocalOnlyPill.tsx` (renderer) | `apps/desktop/src/renderer/components/LocalOnlyPill.tsx` | Title-bar pill (high contrast). One-click toggle, right-click → Privacy. |
| `PrivacyPanel.tsx` (renderer)  | `apps/desktop/src/renderer/views/PrivacyPanel.tsx`       | Settings → Privacy section with allowlist editor + this threat model.    |

## Policy evaluation

Pseudocode for `checkOutbound(url, policy)`:

```text
if URL is malformed                          -> BLOCK (reason = allowlist)
if policy.localOnlyMode == true:
    if host is loopback (127.x, ::1)         -> ALLOW
    if host matches '127.0.0.1' / 'localhost' / '*.local' -> ALLOW
    else                                     -> BLOCK (LocalOnlyBlockedError)
else:
    if policy.allowlist is empty             -> ALLOW (legacy behavior)
    if host is loopback                      -> ALLOW
    if host matches any allowlist entry      -> ALLOW
    else                                     -> BLOCK (NetworkAllowlistBlockedError)
```

Wildcards use the `*.example.com` form: any direct or nested subdomain of
`example.com`, plus the apex itself. There is no glob, regex, or path matching
— hosts only.

## Trust boundaries

```
+-----------------------------+        +------------------------------+
|    Renderer (UI)            |        |  External services           |
|                             |        |  (provider APIs, web sites,  |
|   PrivacyPanel / Pill       |        |   MCP servers, …)            |
+--------------+--------------+        +---------------^--------------+
               | IPC                                   | HTTPS / sockets
               v                                       |
+--------------+----------------------------+----------+--------------+
|   Main process                                                       |
|                                                                      |
|   security/network-policy.ts  <----  consulted by every outbound      |
|                                      caller before fetch()           |
|                                                                      |
|   - web_fetch tool                                                   |
|   - LLMProvider.stream()                                             |
|   - MCP transport (over HTTP)                                        |
|   - Plugin host's fetch wrapper                                      |
+----------------------------------------------------------------------+
```

The main process owns the policy. Renderers never bypass it: they only ask the
main process to _change_ the policy via the typed IPC channels. Plugins run in
the main process and must call `isOutboundAllowed(url)` (or use the policy-
aware wrapper) before `fetch`; a future SDK update will inject a default
`fetch` that does this transparently.

## Attack tree

```
Goal: exfiltrate workspace data to an attacker-controlled host
│
├── 1. Compromise a provider response and have it ask the agent to call web_fetch
│       ├── 1.a  attacker host in allowlist?   --> request sent  (residual risk)
│       └── 1.b  attacker host NOT in allowlist
│              ├── Local Only ON  --> blocked at the policy layer (DEFENSE)
│              └── Local Only OFF --> blocked by the allowlist     (DEFENSE)
│
├── 2. Plugin makes its own fetch() against the policy
│       ├── Plugin uses host-injected wrapper  --> blocked        (DEFENSE)
│       └── Plugin uses node:http directly     --> NOT blocked    (residual risk)
│              Mitigation: only install plugins with the
│              `network` permission you trust; review their code.
│
├── 3. run_shell call invokes curl / wget / git push
│       --> NOT blocked: this layer does not sandbox subprocesses.
│              Mitigation: approval system (execute tier) requires user
│              consent before run_shell executes; default policy in v1
│              is "prompt" for execute-tier tools.
│
└── 4. Provider HTTPS call leaks data to a different endpoint than expected
        ├── Provider base URL is in allowlist  --> request sent  (residual risk)
        └── Provider base URL NOT in allowlist --> blocked       (DEFENSE)
              Recommendation: use the typed allowlist to pin
              provider endpoints (e.g. only `api.anthropic.com`).
```

## Persistence and migration

- The policy is persisted to `<userData>/privacy.json` via `electron-store`
  (namespace `privacy.network`).
- The default policy is `{ localOnlyMode: false, allowlist: ['127.0.0.1',
'localhost', '*.local'] }`. This preserves legacy behavior (allowlist with
  loopback entries is functionally equivalent to "allow all" because the
  empty-allowlist short-circuit was the previous default).
- A future consolidation patch may fold these fields into the central
  `apps/desktop/src/main/storage/settings.ts` schema as
  `localOnlyMode: boolean` and `networkAllowlist: string[]`.

## How to verify

1. Open Settings → Privacy.
2. Toggle Local Only ON. The title-bar pill turns green.
3. In Chat, ask the agent to call `web_fetch` against `https://example.com`.
4. The tool call fails with `LocalOnlyBlockedError`.
5. Toggle Local Only OFF, add `example.com` to the allowlist, and retry — the
   request now succeeds.
6. Remove `example.com` from the allowlist while leaving Local Only OFF — the
   request is blocked with `NetworkAllowlistBlockedError`.

## Future work

- Plugin SDK: inject a policy-aware `fetch` by default so third-party plugins
  cannot bypass the allowlist unless they explicitly opt out (and the user
  grants a `network-bypass` permission at install time).
- Per-provider allowlist: tie individual providers to a fixed set of base URLs
  so a misconfigured provider can't reach an unexpected host even when the
  global allowlist is permissive.
- Surface blocked-request counts in the status bar so the user notices
  unexpected outbound attempts even when running unattended.
