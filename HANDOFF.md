# Handoff State

## Last Session Summary

- **Provider config UI shipped end-to-end.** Settings → Providers now renders a card per adapter (all 7 from Phase 1) with API key field, base URL override, per-provider extra fields (e.g. OpenAI `organization`/`project`, Anthropic `anthropicVersion`/`beta`, OpenRouter `referer`/`title`, Ollama `keepAlive`, Google `apiVersion`), Save / Test / Clear actions, and a last-test-result line with timestamp.
- **Secrets land in keytar** at account `provider:<id>:apiKey`; non-secret config (baseUrl, extra, lastTestedAt, lastTestResult) lives in `electron-store` under a new `providers` map in [apps/desktop/src/main/storage/settings.ts](apps/desktop/src/main/storage/settings.ts). API key edits use a dirty-flag so a Save that only changes baseUrl/extra doesn't disturb keytar.
- **15 new tests, 171 total green** across 20 files. New ones cover the per-provider ping-spec catalog and a stubbed-fetch ping classifier (200/401/403/5xx/network/timeout). Desktop build sizes: main 21.93 kB, preload 0.64 kB, renderer 281.54 kB JS + 4.08 kB CSS.

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. `pnpm test` should report **171 passing tests across 20 files**. Build sizes per above.
- [ ] **Format quirk reminder** — Prettier escapes bare underscores in long single-paragraph bullets. Wrap terms like `tool_use`, `stream_options`, `keep_alive`, `done_reason` in backticks in HANDOFF/docs.
- [ ] **Native deps inside Electron** (carry-over, only if you run `pnpm --filter @opencodex/desktop dev`).

## Next Task

Phase 1 → UI. Recommended next chunk:

> ### UI
>
> - [ ] Model picker with cost + context window display + capabilities badges
> - [ ] Capabilities-driven UI gating (hide tools toggle if `!toolUse`)

The plumbing is already in place: `providers:list` returns each provider's `ModelCapabilities[]` (with `contextWindow`, `pricing`, `toolUse`, `vision`, `embeddings`, `promptCaching`), so a Model picker can consume the same `window.opencodex.providers.list()` call the Settings panel uses. Natural shape: a top-bar dropdown that lists all _configured_ providers (`status.hasApiKey || !info.requiresApiKey`) and lets the user pick a model; show pricing/context-window chips next to each entry; UI-gate the tools toggle on `selectedModel.toolUse`.

Alternative smaller follow-ups:

- [ ] OpenAI Responses API (deferred half of the OpenAI adapter)
- [ ] Ollama JSON-mode prompt-injection fallback for legacy non-tool-capable models
- [ ] Real-API-recorded fixtures (current tests use hand-crafted fixtures)
- [ ] Streaming chat view (Phase 1 → UI) — bigger; needs an active-provider selector first, so ideally do Model picker before this

## Context Notes

### Provider config UI architecture (this session)

- **Single source of truth**: [apps/desktop/src/main/providers/catalog.ts](apps/desktop/src/main/providers/catalog.ts) lists each provider with `factory`, `defaultBaseUrl`, `requiresApiKey`, `extraFields[]`, `loadModels()`, and `buildPingSpec()`. Adding an 8th provider means appending one entry — _and_ reflecting `extraFields` in the renderer is automatic, the form renders from the catalog.
- **IPC surface** (in [shared/ipc-types.ts](apps/desktop/src/shared/ipc-types.ts)): `providers:list | save | delete | test`. Renderer types live in [shared/provider-config.ts](apps/desktop/src/shared/provider-config.ts) — `ProviderListItem`, `ProviderSaveRequest`, `ProviderTestResult`, `ProviderConfigIssue`.
- **Test-connection is a free `GET`**, not a chat call. Per-provider endpoint dispatch:
  - OpenAI / xAI / Mistral / OpenRouter (`/auth/key` for OR) → `GET {base}/...` with `Authorization: Bearer`
  - Anthropic → `GET {base}/models` with `x-api-key` + `anthropic-version`
  - Google → `GET {base}/{apiVersion}/models?key=...` (query-string auth, no header)
  - Ollama → `GET {base}/api/tags` (no auth)

  See [apps/desktop/src/main/providers/catalog.ts:73-225](apps/desktop/src/main/providers/catalog.ts#L73). The generic classifier in [ping.ts](apps/desktop/src/main/providers/ping.ts) treats 401/403 → `auth`, other non-2xx → `http`, throw → `network`, abort → `timeout`.

- **API key dirty-tracking**: the renderer ([ProvidersPanel.tsx](apps/desktop/src/renderer/views/ProvidersPanel.tsx)) tracks `apiKeyDirty` per draft; Save only sends `apiKey` when the field was edited. If user types and clears, that's a delete intent (`apiKey: null`).

- **Validation**: handler runs `buildProviderConfig(entry, ...)` → `factory.configSchema.parse(raw)` before persisting. On `ZodError`, returns `{item, errors: ProviderConfigIssue[]}` instead of throwing — renderer displays them inline. Successful save returns `{item, errors: []}`.

### React/lint gotcha

- ESLint rule `react-hooks/set-state-in-effect` (React 19 hooks plugin) flags `void load()` calls inside `useEffect` when `load` does `setState`. Fix is to inline the async IIFE inside the effect body with a `cancelled` flag, and use a `reloadKey` counter (`setReloadKey(k => k + 1)`) to trigger re-fetch from a Retry button. Same pattern will likely come up again for Model picker and chat view.

### Adapter-side details still relevant

- **Wrap-vs-copy adapter split**: xAI + OpenRouter wrap `@opencodex/provider-openai` (re-exported helpers are semi-public — any change there must check xAI + OpenRouter still build); Mistral + Ollama copy+adapt because of wire quirks (Mistral: optional `index` on tool-call chunks, no `stream_options`; Ollama: NDJSON not SSE, synthesizes tool-call IDs, `keepAlive` → `keep_alive`).
- **Embeddings**: only Mistral and Ollama implement `embed()` today; Anthropic / Google / xAI / OpenRouter throw.

### Carry-overs

- Folder path has a space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true`. Before any `pnpm publish`, swap to `tsup` per package.
- `.github/workflows/ci.yml` still doesn't run `pnpm build`. With 20 test files / 171 tests now, double-check it actually runs them.
- Placeholders to fill before going public: `@TODO-set-github-handle` (CODEOWNERS), `security@TODO-set-domain` (SECURITY.md), `github.com/TODO-org/TODO-repo` (issue template config).
- OpenAI Responses API still deferred — Chat Completions is enough for the agent loop and now the UI.
- [packages/core/src/tool.ts](packages/core/src/tool.ts) still has both `ToolDefinition.inputSchema` (JSON Schema) and `Tool.inputZod` — intentionally separate, defer unification to Phase 2.
