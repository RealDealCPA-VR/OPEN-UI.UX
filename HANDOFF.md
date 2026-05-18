# Handoff State

## Last Session Summary

- **Provider packages split 7 ways.** Old single `packages/providers` package removed; replaced by `packages/provider-{openai,anthropic,google,xai,mistral,ollama,openrouter}`, each its own `@opencodex/provider-<name>` workspace package. Path mappings updated in both `tsconfig.base.json` and `apps/desktop/tsconfig.json`; `apps/desktop/package.json` now depends on all 7 individually. Docs/READMEs updated.
- **OpenAI adapter implemented for real** (Chat Completions only — Responses API still TODO). Raw `fetch`, no `openai` SDK. Module layout under `packages/provider-openai/src/`: `config.ts` (extends `providerConfigSchema` with `organization`+`project`), `models.ts` (8-entry capabilities table with pricing), `sse.ts` (generic SSE parser), `response-schemas.ts` (Zod at the wire boundary), `translate-request.ts` (Message[]/ToolDefinition[] → OpenAI body — handles text, image data-URL, `tool_use`, `tool_result`), `translate-stream.ts` (accumulates tool calls across chunks, maps `finish_reason` → `StopReason`), `provider.ts` (the `OpenAIProvider` class + `openAIProvider` factory: streaming chat, embeddings, listModels, capabilities, custom baseUrl, error events on HTTP failure).
- **29 new tests added, 45 total green.** OpenAI: `sse.test.ts` (6), `translate-request.test.ts` (11), `translate-stream.test.ts` (6), `provider.test.ts` (6, fixture-based — no live API). Core's 16 still pass.

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. `pnpm test` should now report **45 passing tests across 6 files**. Build sizes unchanged: main 7.31 kB, preload 0.37 kB (.mjs), renderer 271.65 kB JS + 1.31 kB CSS.
- [ ] **Native deps load inside Electron** (carry-over, only if you run `pnpm --filter @opencodex/desktop dev`).

## Next Task

Phase 1 → Adapters (continued). Decide first:

1. Whether to ship the OpenAI **Responses API** path before moving on (the Todo line still has it open). It's mostly the same surface as Chat Completions but a different endpoint and different streaming event names. Recommended: defer — Chat Completions is sufficient for the agent loop and we can come back when there's a concrete consumer need.
2. Then proceed in the original order — Anthropic next:

> - [ ] `packages/providers/anthropic`: Messages API with prompt caching, tool use, vision
> - [ ] `packages/providers/google`: Gemini API, tool calls, vision
> - [ ] `packages/providers/xai`: Grok API (OpenAI-compatible)
> - [ ] `packages/providers/mistral`: Mistral API, tool calls
> - [ ] `packages/providers/ollama`: Local Ollama HTTP, streaming, tool-call JSON-mode fallback
> - [ ] `packages/providers/openrouter`: OpenRouter unified API (covers fallback "any model")

## Context Notes

### Provider package naming + structure

Each provider lives at `packages/provider-<id>` with package name `@opencodex/provider-<id>`. Each has `package.json` (`type: module`, `main: dist/index.js`, scripts: build/typecheck/test/lint/clean, deps: `@opencodex/core` workspace + `zod`), `tsconfig.json` (`extends ../../tsconfig.base.json`, `noEmit: true`), and `src/index.ts`. When adding a new workspace package, also update path mappings in **both** `tsconfig.base.json` and `apps/desktop/tsconfig.json` AND add it to the `resolve.alias` in `vitest.config.ts` (see below).

### Vitest alias requirement (load-bearing — easy to miss)

`vitest.config.ts` now has an explicit `resolve.alias` map for every `@opencodex/*` package because their `package.json` `main` points at unbuilt `dist/`. Without aliases, any test that triggers a runtime _value_ import of a `@opencodex/*` package (not just `import type`) fails with `Failed to resolve entry for package`. When you add provider-anthropic etc., add an alias entry next to the existing ones. The old `vitest.workspace.ts` was deleted — it isolated each package's resolver from the root config's aliases. The root `vitest.config.ts` now drives all test discovery via `include: ['**/*.{test,spec}.{ts,tsx}']`.

### Reusable helpers from OpenAI adapter

The xAI and OpenRouter adapters will be OpenAI-compatible. The current helpers worth reusing:

- `packages/provider-openai/src/sse.ts` — generic SSE event-stream → string async generator (decoder + buffer + CRLF normalize).
- `packages/provider-openai/src/translate-request.ts` — `translateMessages`, `translateTools`, `buildChatRequestBody`.
- `packages/provider-openai/src/translate-stream.ts` — `streamChunksToEvents` (tool-call accumulation by `index`, `finish_reason` mapping).
- `packages/provider-openai/src/response-schemas.ts` — `chatChunkSchema` for the wire body shape.

Decide later whether to extract these to a shared `@opencodex/provider-openai-compat` package or just import directly from `@opencodex/provider-openai`. For two consumers (xAI + OpenRouter), direct import is fine.

### No SDKs, raw fetch

The OpenAI adapter uses `fetch` directly — no `openai` npm package. Keeps deps lean and makes fixture-based tests trivial (mock `globalThis.fetch`, return synthetic SSE bodies). Apply the same approach to other adapters unless an SDK gives meaningful leverage. Per CLAUDE.md carry-over: install provider SDKs in the adapter package's `package.json`, not at the root.

### Adapter pattern to follow

For each new provider adapter:

1. Add provider-specific config fields (if any) by extending `providerConfigSchema` in `config.ts`. Set `configSchema` on the factory to the extended schema so registry validation is narrow.
2. Build the request body in a `translate-request.ts`; messages flow main → adapter as our internal `Message` type.
3. Validate every wire response (stream chunk or JSON body) with Zod in `response-schemas.ts` _before_ touching it. This is the "external boundary" per CLAUDE.md.
4. Translate provider events → `ChatEvent` discriminated-union in `translate-stream.ts`. The accumulation pattern (Map keyed by tool-call index, flush at end) handles streamed tool-call fragments cleanly.
5. Capabilities live in a hard-coded `models.ts` table. `listModels()` returns it; `capabilities(id)` is a lookup.
6. Class implementation in `provider.ts`. Pre-2xx errors yield an `error` event followed by `done` with `stopReason: 'error'` — do NOT throw from the generator.
7. Tests: at minimum one fixture-based provider test plus translator/stream unit tests. Mock `globalThis.fetch` via a small `stubFetch` helper (see [provider.test.ts](packages/provider-openai/src/provider.test.ts)); `vi.fn` of a `()=>Response` impl infers args as `[]` and breaks `mock.calls[0]?.[1]` indexing under `noUncheckedIndexedAccess`.

### Where ChatRequest is NOT validated

Still no Zod on `ChatRequest` — that's an internal boundary (main → adapter, same process). Per prior session and CLAUDE.md, Zod is only at external boundaries: provider responses, IPC payloads, plugin manifests, MCP messages.

### Carry-overs from prior sessions (still relevant)

- Folder path has a space + period (`OPEN UI.UX`). Quote in shell commands.
- `packages/*` `tsconfig` is `noEmit: true`. Consumers use path mappings to `src/`. Before any `pnpm publish`, swap to `tsup` per package — irrelevant for now.
- Placeholders to fill before going public: `@TODO-set-github-handle` (CODEOWNERS), `security@TODO-set-domain` (SECURITY.md), `github.com/TODO-org/TODO-repo` (issue template config).
- CI workflow (`.github/workflows/ci.yml`) still doesn't run `pnpm build`. Now that 45 tests exist, double-check it runs them (the prior session said yes; reverify if you touch CI).
- `packages/core/src/tool.ts` still has both `ToolDefinition.inputSchema: Record<string, unknown>` (JSON Schema for provider) and `Tool.inputZod: z.ZodType<TInput>` — intentionally separate, defer unification to Phase 2.
