# Handoff State

## Last Session Summary

Goal: "find what's missing to make OpenCodex mind-blowing, then fan out agents to complete it to 100%." Ran an ultraplan gap-analysis against a verified-current baseline (the 2026-05-29 audit was stale — 10/11 of its critical items were already fixed), wrote the prioritized backlog to **`docs/MINDBLOWING-PLAN.md`**, then executed **8 verified workflow rounds** (≈48 agents). Every round was implementer→independent-verifier and gated by the lead.

- **R1 — backlog (9 file-disjoint items):** Google embeddings (`gemini-embedding-001` + `batchEmbedContents`, index-preserving) & prompt-safety blocks; RAG **RRF** fusion wired into `search_codebase`; PluginSearchPanel security regression test; SettingsRail Cmd/Ctrl+F scoping; Fanout/AgentTree lifecycle-race fixes; plugin providers in the model-picker; MANUAL/README/CLAUDE + runner docs drift.
- **R2–R4, R6, R8 — `@opencodex/code-graph` (the headline feature), built end-to-end and LIVE:**
  - New package: graphology `DirectedGraph`, Zod node/edge schemas, unicode ID-normalization, Jaro-Winkler dedup, Louvain communities (seeded).
  - Extraction: `@opencodex/rag-chunker` now emits an `ExtractionResult` (symbols + contains/method edges + calls + imports) from its existing tree-sitter walk; deterministic cross-file resolution (import-guided EXTRACTED / unique-label INFERRED).
  - Desktop: migration **v21** (`code_graph_nodes`/`code_graph_edges`), store + builder, indexer hook, `query_code_graph` agent tool via injectable resolver (installed at startup `index.ts`), and a lazy **cytoscape** graph view (Tree|Graph tab in CodebaseView).
  - **Grammars activated:** `tree-sitter-wasms@0.1.13` ABI-proven against `web-tree-sitter@0.22.6` (Node load+parse test extracts real symbols); `electron-builder` extraResources + `scripts/copy-grammars.mjs`. AST chunking + graph extraction are no longer dormant.
- **R5 — UX polish:** all **73** non-Settings findings in `docs/UX-REVIEW.md` (6 disjoint groups): hand-rolled modals → shared `<Modal>`, phantom `--radius-md`/`--shadow-popover` remapped, `aria-labelledby`/`aria-label`/combobox semantics, nested-button fix, stale color-token fallbacks dropped. `styles.css` untouched.
- **R7 — plugin slash-command dispatch:** main dispatcher + 2 Zod IPC channels + composer integration (commands grouped "Plugin — <name>").

## Verify Before Continuing

- [ ] **Full gate:** `pnpm -r typecheck` (0), `pnpm -r lint` (0), `pnpm -r build` (0), `pnpm test` (~2347 pass).
- [ ] **Known flakes only (NOT regressions):** under full-suite parallel load, Windows `EBUSY`/`ENOTDIR` temp-cleanup races flake `checkpoints/manager.test.ts`, `agent/git-init.test.ts`, `agent/merge-review.test.ts`, and the `stdio-transport.test.ts` concurrency flake. **All pass in isolation** (e.g. `npx vitest run apps/desktop/src/main/checkpoints/manager.test.ts` → 18/18). If you see ≤8 failures and they're all EBUSY/ENOTDIR/stdio-transport, re-run isolated.
- [ ] **better-sqlite3 ABI sentinel quirk:** any `pnpm install` runs `electron-rebuild` (Electron ABI 123) but does NOT update the `.opencodex-abi` sentinel, so the next `pnpm test` pretest fast-path may skip the Node rebuild. If DB tests throw `ERR_DLOPEN`/`NODE_MODULE_VERSION 123 vs 115`, run `cd apps/desktop && pnpm rebuild better-sqlite3` to force the Node ABI. (Pre-existing; consider deleting the sentinel fast-path or having postinstall clear it.)
- [ ] **Code graph live check:** open a workspace, let indexing run; CodebaseView → Graph tab should populate; the agent can call `query_code_graph` (neighbors/callers/callees/path/subsystem).

## Next Task

The two remaining non-blocked items, in priority order:

1. **T2.1 — plugin process isolation (the one deferred security item).** Mitigations already shipped (honest docs; `installPluginFromPath` hard-fails on unsigned + consent). Remaining: move plugin execution out of the main process into `electron.utilityProcess.fork()` + `MessagePortMain` RPC + Node `--permission` flags, replacing the bare `await import(moduleUrl)` in `packages/plugin-sdk/src/loader.ts:51`. Reuse the `runSubagentInWorker` pattern (`apps/desktop/src/main/agent/worker-host.ts`). **Requires a running Electron app to validate the RPC/activation path — was deliberately not attempted headlessly to avoid shipping unverifiable code.**
2. **Grammar-bundle packaged-app smoke test** — `copy-grammars.mjs` + extraResources are wired and unit-tested, but the only thing not verifiable headlessly is that the wasm actually resolves inside a _packaged_ build. Smoke-test a real `pnpm build` + packaged launch.

See `docs/MINDBLOWING-PLAN.md` for the full tier-by-tier status and the **BLOCKED** list (code-signing certs, public release, MCP OAuth, cloud/voice/mobile/team/visual-builder/JetBrains+VSCode) — these genuinely require user-owned resources or violate the local-first rule, and cannot be completed by an agent.

## Context Notes

- **Multi-agent pattern that worked:** file-disjoint groups (no file in two groups) edited live in parallel, each piped to an independent verifier; the lead handles shared-config files (`vitest.config.ts`, `tsconfig.base.json`, `package.json` deps) and runs the gate. New interdependent packages were built in sequenced stages (core → extraction → desktop → view), gating each before the next.
- **Verifier scope-noise:** verifiers repeatedly flagged sibling rounds' edits as "foreign / out-of-scope" and `vitest.config.ts`/`tsconfig.base.json` as "prohibited edits" — those are the lead's legitimate code-graph alias additions, not agent scope violations. The git tree was clean at session start (all prior work committed); nothing was committed this session.
- **New deps added (lead):** `graphology`, `graphology-communities-louvain` (code-graph); `cytoscape` + `@types/cytoscape` (desktop graph view); `tree-sitter-wasms` (rag-chunker + desktop, grammars). `apps/desktop` now depends on `@opencodex/code-graph` (`workspace:*`).
- **Pre-existing carry-overs (still true):** Node 20 pinned · path has a space + period (`OPEN UI.UX`) — quote in shell · vitest must run from repo root.
