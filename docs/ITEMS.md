# OpenCodex — Defects & Incomplete Work

_Compiled from build/test/lint/typecheck signal + a 14-subsystem read-only discovery sweep. 38 items in 24 file-disjoint work groups._

| Status sources | Result                             |
| -------------- | ---------------------------------- |
| Build          | green                              |
| Typecheck      | green                              |
| Lint           | 1 error (ReplayPanel)              |
| Tests          | 1 failed / 1937 passed / 8 skipped |

## G1 — HIGH (1 item)

Files: `apps/desktop/src/main/providers/catalog.test.ts`

- **[H stale-test] Stale provider catalog test: expects 7 ids but catalog has 8 (voyage)**
  - Evidence: catalog.test.ts:7 toEqual 7-id array; catalog includes voyage -> 8. Test FAILS.
  - Fix: Update the expected array to include voyage and fix the title/count wording (seven->eight).

## G2 — HIGH (1 item)

Files: `apps/desktop/src/renderer/views/ReplayPanel.tsx`

- **[H lint] Lint error: setState synchronously in useEffect in ReplayPanel**
  - Evidence: ReplayPanel.tsx:44 void load() inside useEffect trips react-hooks/set-state-in-effect.
  - Fix: Refactor so the effect does not synchronously setState (guard/async pattern consistent with other panels). Keep behavior identical.

## G3 — HIGH (2 items)

Files: `apps/desktop/src/renderer/components/JobsPane.tsx`, `apps/desktop/src/renderer/components/JobsPane.test.tsx`, `apps/desktop/src/test/setup.ts`

- **[H bug] React warning: Functions are not valid as a React child (JobsPane)**
  - Evidence: Rendering JobsPane via LeftColumnContextPane logs Functions are not valid as a React child. A function is rendered as a child somewhere in JobsPane subtree.
  - Fix: Trace the function-as-child (likely a helper referenced without calling, or a component passed by value) and render it correctly. Add a test asserting the fetched-run render path.
- **[M missing-test] JobsPane has no test covering the real bridge-fetch render path (the gap that hides item 3's function-as-child warning)**
  - Evidence: JobsPane.test.tsx:124 renders <JobsPane/> with listRuns mocked to async()=>[makeRun()] but only asserts onRunsChanged was called (line 125); it never asserts the fetched run renders. All other JobsPane tests pass initialRuns, short-circuiting the bridge path at JobsPane.tsx:25 (`if (initialRuns !== undefined) return`). So the `initialRuns === undefined` branch that calls bridge.agent.listRuns()+setRuns(list) (JobsPane.tsx:35-36) is never asserted against rendered output. This is why the real-bridge render bug (item 3) surfaces only as a console warning in an unrelated test (LeftColumnContextPane.test.tsx) rather than a failing assertion.
  - Fix: Add a JobsPane test that sets a bridge whose listRuns resolves a concrete AgentRun[] (running status) and asserts the run's task/tokens render and that NO 'Functions are not valid as a React child' warning is emitted (e.g. spy on console.error and assert not called). This both closes the coverage gap and would have caught the test-shim interaction behind item 3.

## G9 — HIGH (2 items)

Files: `apps/desktop/src/main/agent/merge-review.ts`, `apps/desktop/src/main/agent/subagent.ts`, `apps/desktop/src/main/agent/spawn-from-ui.ts`, `apps/desktop/src/main/agent/worktrees.ts`, `apps/desktop/src/main/agent/worktree-diff-preview.ts`

- **[H bug] acceptMerge merges an empty branch — uncommitted subagent changes are silently dropped**
  - Evidence: merge-review.ts:90 runs `git merge --no-ff <branch>` from worktreeRepoRoot, but nothing in the agent flow ever commits the subagent's edits (grep for 'commit' across apps/desktop/src/main/agent shows commits only in git-init.ts and tests). runSubagent (subagent.ts) and the runners (core/runner.ts) only invoke tools that write files; the worktree branch still points at the base HEAD, so the merge is a no-op ('Already up to date') and the accepted work is lost. The accept test (merge-review.test.ts:173) only passes because it manually `git commit`s in the worktree first.
  - Fix: Before acceptMerge (or at subagent completion when a worktree exists), stage and commit the worktree state, e.g. `git add -A && git commit -m "subagent <runId>"` in run.worktreePath, then merge that commit. Alternatively merge via `git merge --squash` after committing, or apply the diff bundle. Either way a commit step is mandatory.
- **[H bug] New files created by a subagent are invisible to merge bundle and worktree preview (git diff HEAD skips untracked files)**
  - Evidence: getDiffBundle (worktrees.ts:184) runs `git diff HEAD` and getWorktreePreview (worktree-diff-preview.ts:83) runs `git diff --numstat HEAD`; neither stages untracked files, so brand-new files written by the subagent's Write tool do not appear in prepareMergeBundle's diff/files (merge-review.ts:54-55) or in the diff preview. Every test deliberately calls `git add NEW.txt` before asserting (worktrees.test.ts:131, merge-review.test.ts:151), confirming the code only surfaces tracked/staged changes — the production path never stages.
  - Fix: Stage the worktree (`git add -A`) before computing the diff, or use `git diff HEAD --` combined with `git status --porcelain`/`git diff --no-index` for untracked files, or commit first (which also fixes the accept bug) and diff the commit. The preview should reflect the same staged/committed state that acceptMerge will use.

## G10 — HIGH (2 items)

Files: `apps/desktop/src/shared/mcp.ts`, `apps/desktop/src/main/mcp/handlers.ts`, `apps/desktop/src/main/mcp/manager.ts`, `packages/mcp-client/src/config.ts`, `packages/mcp-client/src/host-guard.ts`, `packages/mcp-client/src/http-transport.ts`, `packages/mcp-client/src/sse-transport.ts`

- **[H contract-mismatch] hostAllowlist is stripped by the desktop IPC schema, making private/LAN HTTP+SSE MCP servers impossible to add**
  - Evidence: apps/desktop/src/shared/mcp.ts:11-21 define mcpSseConfigSchema/mcpHttpConfigSchema WITHOUT a hostAllowlist field, but packages/mcp-client/src/config.ts:15,22 define it as the ONLY way to opt past the host-guard. handlers.ts:20-22 parse the add request through mcpServerEntrySchema (which uses the desktop schema), and Zod's default object strips the unknown hostAllowlist key. manager.ts:206 then casts the stripped config to McpServerConfig, so the transport (sse-transport.ts:70 / http-transport.ts:18) always sees allowlist=undefined. host-guard.ts:96-107 then blocks all RFC1918/link-local hosts with no override path. Net: a user can never add an HTTP/SSE MCP server bound to a private/LAN address (e.g. a router- or internal-hosted MCP), which contradicts the local-first design.
  - Fix: Add `hostAllowlist: z.array(z.string()).optional()` to mcpSseConfigSchema and mcpHttpConfigSchema in apps/desktop/src/shared/mcp.ts so the field survives the IPC parse and reaches the transport.
- **[M validation-gap] Host-guard SSRF protection is bypassable via HTTP redirects (fetch follows 3xx by default)**
  - Evidence: assertHostAllowed only validates the configured URL at construction (http-transport.ts:18, sse-transport.ts:70). Every subsequent fetch (http-transport.ts:45 POST, http-transport.ts:88 GET listen channel, sse-transport.ts:83 GET, sse-transport.ts:134 POST) uses the default redirect mode ('follow'), so an allowed/public MCP endpoint can 30x-redirect to a blocked target such as http://169.254.169.254/ or an RFC1918 host and fetch will silently follow it, defeating the guard that exists specifically for SSRF prevention. None of the fetch calls set `redirect: 'error'` or re-validate the final response.url.
  - Fix: Pass `redirect: 'error'` (or 'manual' with explicit re-validation via assertHostAllowed on response.url) on all fetch calls in http-transport.ts and sse-transport.ts so cross-host redirects to blocked addresses are rejected.

## G12 — HIGH (1 item)

Files: `apps/desktop/src/main/rag/vector-store.ts`

- **[H bug] Magnitude-bucket prefilter drops the true top cosine matches**
  - Evidence: vector-store.ts:156-177 — searchByVector prefilters candidates to magnitude window [lowNorm,highNorm] around the query norm, but ranking is cosine similarity which is magnitude-invariant; a perfectly-aligned chunk (cosine≈1) whose stored norm sits in a different bucket is excluded. The fallback at :173 (rows.length < clamped → scan all) only fires when the bucket is sparse; once ≥ candidateLimit (max(limit\*8,256)) vectors fall in-bucket, the true high-cosine matches outside the bucket are silently dropped and never ranked.
  - Fix: Drop the magnitude prefilter for cosine ranking (it is not a valid ANN prefilter for cosine), or L2-normalize embeddings at upsert so all magnitudes ≈1 and the bucket window is a no-op. Alternatively always scan all rows up to a hard cap, since the store is documented as O(N) anyway.

## G16 — HIGH (2 items)

Files: `apps/desktop/src/main/scheduler/handlers.ts`, `apps/desktop/src/renderer/components/ScheduledTaskEditorModal.tsx`, `apps/desktop/src/main/scheduler/store.ts`, `apps/desktop/src/main/scheduler/scheduler.ts`, `apps/desktop/src/shared/scheduled-tasks.ts`

- **[H contract-mismatch] runnerId silently dropped at the scheduler create/update IPC boundary**
  - Evidence: handlers.ts:25-52 createRequestSchema/updateRequestSchema have no runnerId field; ipc/registry.ts:29 uses safeParse on a plain z.object which strips unknown keys, so the runnerId set in ScheduledTaskEditorModal.tsx:326,341 never reaches store.createTask (store.ts:147 would persist req.runnerId). External-runner scheduled tasks always run as 'internal'.
  - Fix: Add `runnerId: z.string().nullable().optional()` to both createRequestSchema and updateRequestSchema in handlers.ts so the value reaches createTask/updateTask (which already persist it).
- **[M contract-mismatch] scheduler:run-completed event emits agentRunId in the runId field**
  - Evidence: handlers.ts:78-83 sends `runId: payload.agentRunId` for the scheduler:run-completed event whose contract type ScheduledRunCompletedEvent (scheduled-tasks.ts:103-108) defines runId and agentRunId as distinct fields. The Notifier signature (scheduler.ts:11-15) only carries agentRunId, so the real scheduled_task_runs.id is never forwarded; any consumer relying on runId gets the agent run id instead.
  - Fix: Extend the Notifier event to carry the scheduled-run runId (returned by fireScheduledTask as res.runId) and forward it, or document runId as the agentRunId and remove the misleading separate field.

## G18 — HIGH (3 items)

Files: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/memory/local-fs-runtime.ts`, `apps/desktop/src/main/memory/local-fs-backend.ts`, `apps/desktop/src/main/memory/manager.ts`, `apps/desktop/src/main/memory/local-fs-handlers.ts`, `apps/desktop/src/renderer/views/MemoryPanel.tsx`

- **[H bug] Local-fs memory agent tools go stale after a workspace switch (point at the old workspace's memory.md)**
  - Evidence: index.ts:411 calls applyLocalFsBackend() exactly once at startup; the activeWorkspace change handler at index.ts:565-567 only restarts the file watcher and never re-invokes applyLocalFsBackend(). buildLocalFsTools (local-fs-backend.ts:33-36) bakes workspaceRoot into LocalFsMemory at registration, so after switching workspaces the registered memory_local_read/search/append tools still read/write the OLD workspace's memory.md.
  - Fix: Call applyLocalFsBackend() from the settingsStore.onDidChange('activeWorkspace') handler (index.ts:565) and also from the memory config-change path so the local-fs tools are unregistered and re-registered against the current activeWorkspace.
- **[H bug] Toggling the local-fs backend via memory:set-config never registers/unregisters its tools**
  - Evidence: manager.ts:116-122 reloadMemory() (invoked by applyMemoryConfig via the memory:set-config IPC handler in handlers.ts:22) only calls applyObsidian() and applyNotion(); it never calls applyLocalFsBackend(). So enabling/disabling backends.localFs.enabled in Settings has no effect on whether the local-fs tools are present in the tool registry until the app is restarted.
  - Fix: Invoke applyLocalFsBackend() inside reloadMemory() (or applyMemoryConfig) alongside applyObsidian/applyNotion so local-fs enable/disable takes effect immediately.
- **[M contract-mismatch] Local-fs backend status is computed but never exposed over IPC; renderer can never display it**
  - Evidence: getLocalFsBackendState() (local-fs-runtime.ts:16) returns enabled/configured/registered/toolCount/lastError, and getMemoryStatus() in manager.ts:138 only maps ['obsidian','notion'] (local-fs excluded). local-fs-handlers.ts registers only read/search/append IPC channels — no status channel. MemoryPanel.tsx initializes 'local-fs': null (line 35) but there is no IPC to populate it, so getLocalFsBackendState is effectively dead and the local-fs backend status never reaches the UI.
  - Fix: Add a 'memory-local-fs:status' invoke channel returning getLocalFsBackendState() and have MemoryPanel fetch it, or fold local-fs into getMemoryStatus().backends.

## G19 — HIGH (2 items)

Files: `examples/plugins/hello-world/opencodex.plugin.json`, `examples/plugins/hello-world/src/index.ts`, `apps/desktop/src/main/plugins/manager.ts`, `apps/desktop/src/main/plugins/manager.test.ts`

- **[H contract-mismatch] hello-world reference plugin fails activation: tool requires workspace.read but manifest grants no permissions**
  - Evidence: hello-world/src/index.ts:11 sets the tool permissionTier:'read'; manager.ts:139-144 maps 'read'->'workspace.read' and registerTool (manager.ts:154-155) calls checkPermission(id,'workspace.read'), but hello-world/opencodex.plugin.json declares "permissions": []. activate() therefore throws inside registerTool; activatePlugin (manager.ts:286-292) catches it and sets status='failed'. The canonical reference plugin never reaches 'loaded' even via the documented Install-from-folder flow (plugins:install-from-path passes no autoGrant).
  - Fix: Add "workspace.read" to the hello-world manifest's permissions array (and have the install flow surface the pending-permissions grant), so the tool's required tier matches a granted permission.
- **[M missing-test] registerTool permission gate (TIER_TO_PERMISSION + checkPermission) has no test coverage**
  - Evidence: manager.ts:139-164 enforces a per-tier permission check on registerTool (the comment at 135-138 says this closes an 'open gate' that previously let any tool register). manager.test.ts only exercises the runner path (agent.runner). There is no test asserting that a 'read'/'write'/'execute'/'network' tool is rejected without the matching permission and accepted with it, and the only in-repo example that would exercise it (hello-world) is itself misconfigured, so the regression went unnoticed.
  - Fix: Add a manager test that installs a plugin contributing a 'read'-tier tool with permissions:[] (expect status 'failed'/no tool registered) and one with permissions:['workspace.read'] (expect 'loaded' and a registered plugin**<id>**<tool> entry), mirroring the existing runner tests.

## G22 — HIGH (5 items)

Files: `packages/runner-claude-code/src/runner.ts`, `packages/runner-opencode/src/runner.ts`, `packages/runner-aider/src/runner.ts`, `packages/core/src/runner.ts`, `packages/core/src/events.ts`, `packages/runner-opencode/README.md`

- **[H bug] Windows command injection: shell:true spawn passes unescaped task to .cmd/.bat/.ps1 runners**
  - Evidence: runner.ts (all three) needsShell() returns true for .cmd/.bat/.ps1 cliPath and spawn is called with { shell: useShell } and args including opts.task (e.g. opencode runner.ts:119-129, claude-code runner.ts:114-129, aider runner.ts:137-145). Node's child_process.spawn does NOT escape argv when shell:true, so a task containing '& calc.exe' or '| ...' is interpreted by cmd.exe. npm-installed CLIs are typically claude.cmd/opencode.cmd, so this path is hit in practice on Windows.
  - Fix: Do not enable shell:true for arbitrary CLIs. On Windows, invoke the interpreter explicitly (cmd.exe /c with a quoted file and properly escaped args) or resolve the underlying .exe, or sanitize/quote opts.task. Keep argv as a real array so the OS, not the shell, receives the task verbatim.
- **[M missing-test] run() generator (spawn/abort/budget/stream-collection) has no tests in any runner**
  - Evidence: Only check-installed.test.ts, line-buffer.test.ts and event-translator.test.ts exist (see packages/runner-\*/src). The exported createXRunner().run() async generator — which owns the actual critical behavior (process spawn, ANSI strip, abort-signal teardown, wall-time budget kill, NDJSON->ChatEvent draining, exit-code/error mapping, terminal done/usage emission) — is exercised by zero tests across all three packages.
  - Fix: Add tests that mock node:child_process spawn (EventEmitter with stdout/stderr/stdin) and drive run() to assert: terminal done emitted on clean/non-zero/spawn-error exits, abort kills the tree and ends the stream, wall-time budget triggers the budget branch, and stdout NDJSON/lines are translated to the expected ChatEvent sequence.
- **[M contract-mismatch] User cancellation (abort) is reported as stopReason 'error' instead of 'cancelled'**
  - Evidence: On abort the runner treeKills the child (e.g. aider runner.ts:189-201); the child then 'close's with exitCode=null and the runner yields { type:'done', stopReason: exitCode===0 ? 'end_turn':'error' } -> 'error' (aider runner.ts:304-307; claude-code runner.ts:306-309; opencode runner.ts:306-309). collectSubagentResult (core/src/runner.ts:162-202) sets stopReason='error' from that done event, and its aborted->'cancelled' override is guarded by `if (stopReason !== 'error')` (line 197), so the cancel is never recorded. Result: deliberate cancellation is indistinguishable from a real failure.
  - Fix: When opts.signal is aborted, have the runner emit a cancellation-flavored terminal (or skip the error done) so collectSubagentResult yields 'cancelled'; or relax the core override to prefer 'cancelled' when signal.aborted even if a non-error-event done already set 'error'.
- **[L contract-mismatch] Wall-time budget kill is surfaced as a generic 'error', not a budget reason (no budget_exceeded mapping exists)**
  - Evidence: SubagentRunner.run JSDoc (core/src/runner.ts:69-72) says runners SHOULD emit a done with stopReason 'budget_exceeded', but stopReasonSchema (core/src/events.ts:30-38) has no 'budget_exceeded' value, so it cannot be emitted as a valid ChatEvent. The runners instead emit { type:'error', ... } + done(error) on budget timeout (aider runner.ts:285-293; claude-code runner.ts:278-286; opencode runner.ts:278-286), and SubagentStopReason (core/src/runner.ts:28-37) also lacks 'budget_exceeded'. A wall-time kill is therefore reported identically to an arbitrary failure, defeating budget observability the contract promises.
  - Fix: Add a 'budget_exceeded' entry to the ChatEvent stopReason vocabulary (and SubagentStopReason / its mapping in collectSubagentResult), then have the budget-timeout branch emit done with that reason; or update the JSDoc to match the actual error-based behavior.
- **[L stale-test] opencode README documents removed CLI flags (--headless --message) that the runner no longer uses**
  - Evidence: README.md:29 and :60 still document the invocation `opencode --headless --message "<task>"`, but runner.ts:119-120 invokes `['run', opts.task]` (+ optional '--model'). Todo.md item 1225 records that --headless/--message are non-existent flags that were removed from the code. The README now mis-documents the actual command and the NDJSON assumption (README:42) for a `run` invocation that emits no output-format flag, so anyone auditing/extending against these docs will reproduce the original broken invocation.
  - Fix: Update README to reflect the `opencode run <task> [--model <id>]` invocation actually used, and confirm/document the flag that makes `opencode run` emit NDJSON on stdout (otherwise JSON.parse drops every line at runner.ts:201-203, yielding an empty transcript).

## G23 — HIGH (2 items)

Files: `packages/crash-reporting/src/index.ts`, `apps/desktop/src/renderer/views/CrashReportingPanel.tsx`

- **[H validation-gap] Native minidump integration bypasses beforeSend scrubbing, contradicting the panel privacy promise**
  - Evidence: index.ts:178 enables sentryMinidumpIntegration() while scrubEvent (the redactor) is wired only as beforeSend (index.ts:120). Sentry's beforeSend runs on JS event payloads, not on native minidump attachments, so crash minidumps (which capture process memory incl. file paths/secrets) are uploaded unscrubbed — directly contradicting CrashReportingPanel.tsx:94-97 'Trace data is scrubbed of local file paths, prompts, completions, and API keys before send.'
  - Fix: Either drop sentryMinidumpIntegration from buildMinimalIntegrations, or gate minidump upload behind an explicit separate consent and update the panel copy to disclose that native minidumps are not path/secret-scrubbed.
- **[L bug] Scrubber recursion has no depth/cycle guard; a cyclic or deeply-nested extra/context can crash the reporter via stack overflow**
  - Evidence: scrubValue (index.ts:311-321) recurses into arrays and objects via scrubObject (303-309) with no visited-set or depth cap. scrubEvent runs inside Sentry's beforeSend; a self-referential object placed in event.extra/contexts/breadcrumb data (common when capturing arbitrary error context) yields infinite recursion -> RangeError, which beforeSend does not catch, so the event capture path itself throws.
  - Fix: Add a depth limit (e.g. bail out at depth ~8 returning '<max-depth>') or a WeakSet of seen objects in scrubObject/scrubValue.

## G4 — MEDIUM (2 items)

Files: `packages/provider-google/src/provider.ts`, `packages/core/src/test-helpers/assert-provider-honors-abort.ts`, `packages/provider-openai/src/assert-provider-honors-abort.test.ts`, `packages/provider-anthropic/src/provider.ts`, `packages/provider-mistral/src/provider.ts`, `packages/provider-ollama/src/provider.ts`, `packages/provider-xai/src/provider.ts`

- **[M unimplemented] Google embeddings unimplemented (throws)**
  - Evidence: provider-google/src/provider.ts:~47 throws Google embeddings not implemented yet.
  - Fix: Implement embeddings against the Gemini embeddings endpoint with Zod-validated response + index-preserving order, set embeddings:true on embedding-capable models, and add a test. If out of scope/no endpoint, keep throwing but mark models embeddings:false consistently and note it.
- **[L missing-test] Abort-conformance helper only exercised for OpenAI; 5 other streaming providers have no cancellation test**
  - Evidence: assertProviderHonorsAbort (packages/core/src/test-helpers/assert-provider-honors-abort.ts) is a published conformance helper for the LLMProvider abort contract, but a repo-wide grep shows it is referenced only by packages/provider-openai/src/assert-provider-honors-abort.test.ts; anthropic/google/mistral/ollama/xai chat() streams (which all wire req.signal into fetch) have no test proving they settle within maxSettleMs on abort.
  - Fix: Add an assertProviderHonorsAbort test (behind a stubbed fetch/transport) to each of the anthropic, google, mistral, ollama, and xai provider packages so the cancellation contract is verified per-provider, matching the existing OpenAI test.

## G5 — MEDIUM (1 item)

Files: `packages/provider-google/src/translate-stream.ts`, `packages/provider-google/src/response-schemas.ts`

- **[M bug] Google: prompt-level safety blocks (promptFeedback.blockReason) are silently swallowed**
  - Evidence: response-schemas.ts:42-49 parses promptFeedback.blockReason, but translate-stream.ts never reads chunk.promptFeedback. When Gemini blocks at the prompt stage it returns a chunk with promptFeedback.blockReason and no candidates/finishReason, so the loop (lines 57-81) emits no error and falls through to 'done end_turn' (line 111-112) — a blocked request looks like a normal empty completion.
  - Fix: In streamChunksToEvents, capture chunk.promptFeedback?.blockReason; after the loop, if a blockReason was seen (and no candidate finishReason already triggered content_filter), emit an { type:'error', code:'content_filter', retryable:false } event followed by { type:'done', stopReason:'content_filter' }, mirroring the candidate-level SAFETY handling.

## G6 — MEDIUM (1 item)

Files: `packages/provider-anthropic/src/translate-stream.ts`, `packages/core/src/api-key.ts`

- **[M bug] Anthropic: cached-input cost double-discounted due to input_tokens semantics mismatch**
  - Evidence: translate-stream.ts:43-45 sets inputTokens = usage.input_tokens and cachedInputTokens = usage.cache_read_input_tokens. Per the Anthropic API, input_tokens EXCLUDES cache-read tokens (they are reported separately), but computeCostUsd (api-key.ts:36-38) does billedInput = inputTokens - cachedInputTokens. This subtracts cache reads from a figure that never contained them, under-billing full-rate input (Math.max can drive it to 0). Anthropic models do carry cachedInputPerMillion (models.ts:15,28,41,54,67) so the costUsd value is wrong. (OpenAI/Google are correct because their prompt token count is inclusive of cached.)
  - Fix: For Anthropic, pass inputTokens as the cache-inclusive total (input_tokens + cache_read_input_tokens) so computeCostUsd's billedInput = total - cached === the true full-rate portion; or add a flag to computeCostUsd indicating whether inputTokens already excludes cached and skip the subtraction for Anthropic.

## G7 — MEDIUM (1 item)

Files: `apps/desktop/src/main/ollama/ollama-installer.ts`

- **[M contract-mismatch] Ollama 'script' installer is advertised to users but is guaranteed to fail (empty pinned SHA-256)**
  - Evidence: ollama-installer.ts:113-122 getAvailableOllamaInstallers() returns 'script' whenever `sh` exists on darwin/linux, but installOllama('script') -> fetchAndVerifyScript() at lines 143-145/185 uses expectedSha = INSTALL_SCRIPT_SHA256 = '' (line 30), so `if (!expectedSha) throw new ScriptInstallerChecksumError('', '<not-fetched>')` always fires. The UI offers a 'script' install option that can never succeed.
  - Fix: Filter 'script' out of getAvailableOllamaInstallers() when the effective expectedScriptSha256 is empty (e.g. `if (kind === 'script' && !INSTALL_SCRIPT_SHA256) continue;`), so the renderer never offers an installer that is wired to fail closed. Alternatively pin a real hash.

## G13 — MEDIUM (1 item)

Files: `apps/desktop/src/main/rag/vector-store.test.ts`

- **[M stale-test] Magnitude-prefilter test only seeds 33 vectors, masking the real prefilter bug**
  - Evidence: vector-store.test.ts:224-235 — 'still returns the highest-cosine match even when many vectors live in distant buckets' seeds only 33 rows (1 match + 32 noise), far below candidateLimit (≥256), so the prefilter returns too few rows and the all-rows fallback at vector-store.ts:173 always triggers. The test passes via fallback and never exercises the case (≥256 in-bucket vectors) where the prefilter actually excludes the correct out-of-bucket match, giving false confidence that ranking is correct.
  - Fix: Seed >candidateLimit (e.g. 300+) orthogonal in-bucket distractors plus one out-of-bucket exact match so the fallback does not engage; assert the exact match is still ranked first. This will currently fail and demonstrate the prefilter defect.

## G17 — MEDIUM (1 item)

Files: `apps/desktop/src/main/scheduler/listener.ts`

- **[M validation-gap] Listener rate limiter does not throttle invalid-signature / unknown-task floods (documented HMAC-burn protection is ineffective)**
  - Evidence: listener.ts:310-313 the comment claims rate limiting runs before signature verification 'so an attacker can't burn CPU on HMAC computations for unknown task ids', but recordTriggerAt is only called at line 358 after a _valid_ signature. lastTriggerAt is never populated by rejected requests, so isRateLimited (line 313) always returns false for them and the HMAC at line 339 is recomputed on every flooded request.
  - Fix: Record the attempt timestamp for every request that passes method/path/content-type checks (e.g. call recordTriggerAt right after the rate-limit check, or before signature verification), so repeated unknown-task/invalid-signature requests are also throttled.

## G20 — MEDIUM (1 item)

Files: `apps/desktop/src/main/agent/resume-handlers.ts`

- **[M bug] agent:respond-resume handler bypasses the senderFrame (non-main-frame) security guard**
  - Evidence: resume-handlers.ts:12 registers via raw ipcMain.handle(agentRespondResumeChannel, ...) instead of registerInvoke. registry.ts:21-28 is the ONLY place that enforces the 'reject IPC from non-main frame (iframe/webview)' guard; this handler does Zod validation but skips that guard, so a sub-frame can invoke agent:respond-resume (which mutates run status via markStatus). It is the only handler in the whole main process that does not go through registerInvoke (grep confirms only registry.ts and resume-handlers.ts call ipcMain.handle).
  - Fix: Register the channel through registerInvoke('agent:respond-resume', agentRespondResumeRequestSchema, handler) like every other invoke handler so the senderFrame guard and uniform validation/logging apply; delete the bespoke ipcMain.handle block.

## G21 — MEDIUM (2 items)

Files: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/file-tree/handlers.ts`, `apps/desktop/src/shared/ipc-types.ts`

- **[M contract-mismatch] file-tree:has-children handler is registered but never exposed in the preload bridge (unreachable from renderer)**
  - Evidence: handlers.ts:82 registers 'file-tree:has-children' and ipc-types.ts:768 declares it, but the preload fileTree object (index.ts:1155-1162) only exposes list(); there is no has-children bridge method (grep for has-children/hasChildren in preload returns only the list() return-type line). The renderer therefore cannot call it. Consequence: file-tree:list (handlers.ts:69) hardcodes hasChildren:false for every entry and nothing ever sets it true, so FileTree.tsx (reads entry.hasChildren) can never show directory-expand affordances — the lazy has-children probe that was built to fix this is dead code.
  - Fix: Expose has-children in the preload bridge (e.g. fileTree.hasChildren(path) -> ipcRenderer.invoke('file-tree:has-children', { path })) and have FileTree populate hasChildren lazily, or remove the unused handler/contract entry if directory arrows are intentionally always shown.
- **[L contract-mismatch] preload fileTree.list() return type omits the 'truncated' field that the handler and contract return**
  - Evidence: index.ts:1156-1162 types fileTree.list as Promise<{ entries: ...; workspaceRoot: string | null }> with no 'truncated', but the handler always returns truncated (handlers.ts:47,73,79) and ipc-types.ts:757-766 declares response.truncated: boolean. The preload type understates the runtime shape, so renderer code can never type-safely read the truncation flag (entries are capped at MAX_ENTRIES=500, handlers.ts:19) and large directories are silently truncated with no UI signal.
  - Fix: Add truncated: boolean to the fileTree.list return type in preload/index.ts to match the contract and handler, or have the preload reuse the IpcInvokeChannels['file-tree:list']['response'] type so the three stay in sync.

## G24 — MEDIUM (1 item)

Files: `apps/desktop/src/main/crash/manager.ts`, `apps/desktop/src/main/telemetry/manager.ts`

- **[M missing-test] Main-process crash/telemetry managers (the real opt-in gating + teardown path) have no tests**
  - Evidence: No \*.test.ts exists for apps/desktop/src/main/crash or apps/desktop/src/main/telemetry (Glob found none). These files own the critical enable->disable->re-enable transitions: crash/manager.ts:82-94 (wasEnabled/willBeEnabled teardown+reinstall branches) and telemetry/manager.ts:74-92 (updateTelemetryConfig fire-and-forget shutdown then recreate). The package units are tested but the gating glue that decides whether anything is ever sent is untested.
  - Fix: Add manager-level tests (mocking @opencodex/crash-reporting and @opencodex/telemetry plus settings storage) covering: enable-from-off installs a client, disable tears down, toggling dsn/apiKey re-installs, and that a disabled config yields a non-enabled client.

## G8 — LOW (1 item)

Files: `apps/desktop/src/main/ollama/ollama-probe.ts`

- **[L validation-gap] Ollama /api/tags probe response parsed with a raw TS cast instead of Zod (boundary-validation rule)**
  - Evidence: ollama-probe.ts:76 `const raw = (await res.json()) as OllamaTagsResponse;` casts an external HTTP response without Zod, contrary to CLAUDE.md ('Zod for runtime validation at every external boundary (provider responses)'). The provider-ollama package validates with chatChunkSchema/embeddingsResponseSchema, but this main-process probe does not; coerceModelEntry's typeof guards prevent a crash, so impact is a style/contract gap rather than a runtime fault.
  - Fix: Define a Zod schema for the tags payload (models: array of { name?/model?/size? }) and `safeParse` the JSON before iterating, mirroring the per-provider packages' boundary validation.

## G11 — LOW (1 item)

Files: `packages/mcp-client/src/protocol.ts`, `packages/mcp-client/src/client.ts`

- **[L bug] Client advertises an older protocolVersion than it actually supports during initialize**
  - Evidence: protocol.ts:3 sets PROTOCOL_VERSION = '2025-03-26', but SUPPORTED_PROTOCOL_VERSIONS (protocol.ts:5-10) lists '2025-06-18' as a newer supported version. client.ts:79 sends protocolVersion: PROTOCOL_VERSION in the initialize request. Per the MCP spec the client should advertise the latest version it supports; advertising 2025-03-26 causes servers to negotiate down and never use 2025-06-18 features the client claims to support.
  - Fix: Set PROTOCOL_VERSION to the newest entry ('2025-06-18'), or send SUPPORTED_PROTOCOL_VERSIONS[0] in the initialize request, keeping the supported list as the acceptance set.

## G14 — LOW (1 item)

Files: `packages/rag-chunker/src/index.ts`

- **[L bug] chunkBySize endLine off-by-one when text ends in a trailing newline**
  - Evidence: index.ts:60-63 — for text fitting in maxChars, endLine = text.split('\n').length. For text ending in '\n' (e.g. 'a\nb\n'), split yields ['a','b',''] (length 3) so endLine=3 although the file has only 2 content lines. This off-by-one propagates through spansToChunks baseLine math (index.ts:296-301, 313-321) into stored chunk line ranges, mis-attributing search-hit startLine/endLine shown to the user.
  - Fix: Compute line count from content excluding a single trailing newline (e.g. count '\n' occurrences and only add 1 when the text does not end in '\n'), and apply the same convention consistently in lineNumberAt-based baseLine offsets.

## G15 — LOW (1 item)

Files: `apps/desktop/src/main/rag/ast-chunk.ts`

- **[L missing-test] AST chunker + grammar registration have no tests on a noUncheckedIndexedAccess critical path**
  - Evidence: No ast-chunk.test.ts exists (Glob found none) and nothing imports astAwareChunkFn/registerBundledGrammars/languageForPath except index.ts wiring. languageForPath (ast-chunk.ts:45) and the EXT_TO_LANGUAGE map (ast-chunk.ts:18-43) plus registerBundledGrammars regex/SUPPORTED_LANGUAGES filtering (ast-chunk.ts:79-87) are the sole path selecting chunking strategy for every indexed file, yet are entirely untested.
  - Fix: Add unit tests: languageForPath for known/unknown/uppercase extensions, and registerBundledGrammars against a temp dir containing valid/invalid/unsupported tree-sitter-\*.wasm filenames asserting the returned count and registered languages.
