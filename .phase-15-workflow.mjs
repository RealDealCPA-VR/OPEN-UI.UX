export const meta = {
  name: 'phase-15-fanout',
  description:
    'Fan-out parallel agents to complete remaining Phase 15 items across packages, desktop main, renderer, build, docs.',
  phases: [
    {
      title: 'Core+contract',
      detail: '15.5 first — core API changes need provider/runner propagation',
    },
    { title: 'Parallel work', detail: '13 sections in parallel across disjoint file sets' },
  ],
};

const ROOT = 'C:\\\\Users\\\\VR\\\\Projects\\\\OPEN UI.UX';

const REPORT_SCHEMA = {
  type: 'object',
  required: [
    'sectionId',
    'itemsCompleted',
    'itemsDeferred',
    'filesModified',
    'lintTypecheckOk',
    'summary',
  ],
  properties: {
    sectionId: { type: 'string', description: 'e.g. "15.3"' },
    itemsCompleted: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'evidence'],
        properties: {
          title: { type: 'string' },
          evidence: {
            type: 'string',
            description: 'file:line refs + what changed + verification done',
          },
        },
      },
    },
    itemsDeferred: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'reason'],
        properties: {
          title: { type: 'string' },
          reason: {
            type: 'string',
            description: 'why deferred (out of scope, needs broader discussion, etc.)',
          },
        },
      },
    },
    filesModified: {
      type: 'array',
      items: { type: 'string', description: 'absolute or repo-relative path' },
    },
    testsAdded: {
      type: 'array',
      items: { type: 'string', description: 'test file paths' },
    },
    lintTypecheckOk: {
      type: 'object',
      required: ['lint', 'typecheck'],
      properties: {
        lint: { type: 'boolean' },
        typecheck: { type: 'boolean' },
        notes: { type: 'string' },
      },
    },
    summary: { type: 'string', description: '2-3 sentences on what landed and why' },
  },
};

// Shared project rules excerpt every agent needs.
const RULES = `
Project rules (from CLAUDE.md):
- TypeScript strict mode + noUncheckedIndexedAccess. No \`any\`; use \`unknown\` + Zod at boundaries.
- ESM only. Kebab-case file names, PascalCase types, camelCase funcs/vars.
- Don't write comments explaining WHAT code does — only WHY when non-obvious. No code-block comments.
- Don't introduce a second LLM abstraction outside packages/core.
- Don't add features needing a hosted backend.

Phase 15 infrastructure already in place (do not change):
- vitest.config.ts now has aliases for @opencodex/memory-local-fs, @opencodex/audit-verify, @opencodex/core/process/tree-kill, and a monaco-editor stub.
- apps/desktop/src/test/setup.ts installs a window.opencodex Proxy shim + afterEach(cleanup).
- apps/desktop/scripts/ensure-native-abi.mjs gates pretest/predev/prebuild against an ABI sentinel file.
- apps/desktop/src/main/storage/lazy-electron-store.ts wraps electron-store construction in a Proxy.
- packages/tools/src/path-guard.ts:resolveWithinWorkspace is now ASYNC — all callers await it.
- packages/*/tsconfig.json now set { outDir: 'dist', rootDir: 'src', paths: {} } and emit to dist/.
- apps/desktop/src/main/plugins/manager.ts hard-fails on unsigned plugins (throws UnsignedPluginRefusedError) and gates registerTool on per-tier permissions.
- scripts/check-build-outputs.mjs verifies each package.json main/types/bin points to a real file.

DO NOT modify Todo.md — return your progress in the structured output and the main agent will update Todo.md.
DO NOT run \`pnpm build\` from your task — it touches too many things and takes minutes. Run \`pnpm --filter <pkg> typecheck\` / \`lint\` / \`vitest run <path>\` for just your area.
DO NOT \`git commit\` or \`git push\`. Just edit files and report what you did.
`;

const PATHS_FOR_EACH = {
  15.3: 'apps/desktop/src/main/{ipc,security}/*, apps/desktop/src/main/index.ts (BrowserWindow + app.on handlers), apps/desktop/src/preload/*',
  15.4: 'packages/mcp-client/src/*',
  15.6: 'packages/provider-{anthropic,google,mistral,ollama,openai,openrouter,voyage,xai}/src/*',
  15.7: 'packages/runner-{aider,claude-code,opencode}/src/*',
  15.8: 'packages/telemetry/src/*, packages/crash-reporting/src/*, apps/desktop/src/main/crash/manager.ts',
  15.9: 'apps/desktop/src/renderer/* (components, views, hooks, state, stores, styles)',
  '15.10': 'apps/desktop/src/main/{codebase,rag,file-tree,git}/*',
  15.11: 'apps/desktop/src/main/{scheduler,triggers,pair,onboarding,skills}/*',
  15.12:
    'apps/desktop/src/main/{storage,tool-audit,providers,selected-model,routing,ollama}/* (NOT touching anything 15.3 touches)',
  15.13: 'packages/memory-{local-fs,obsidian,notion}/src/*',
  15.14: 'packages/plugin-sdk/src/*, examples/plugins/*, scripts/create-opencodex-plugin.mjs',
  15.15:
    '.github/workflows/*, .husky/*, apps/desktop/electron-builder.yml, apps/desktop/playwright.config.ts, tsconfig.base.json, eslint.config.js (paths only — DO NOT change vitest.config.ts, it was fixed in 15.1)',
  15.16:
    'docs/*, README.md, CLAUDE.md, MANUAL.md, HANDOFF.md, QUICKSTART.md, CONTRIBUTING.md, SECURITY.md, RELEASE_NOTES_TEMPLATE.md, website/*, the stray CUsersVRProjects*.tmp file at repo root, PR template',
};

function buildPrompt(sectionId, items, scopeOverride) {
  const scope = scopeOverride ?? PATHS_FOR_EACH[sectionId];
  return `You are working on Phase 15.${sectionId.split('.')[1]} of the OpenCodex codebase audit at ${ROOT}.

${RULES}

YOUR SCOPE: ${scope}

YOUR ITEMS (from Todo.md Phase 15.${sectionId.split('.')[1]}):
${items}

Steps:
1. Read the affected files. Confirm each finding matches reality.
2. Make the smallest changes that fix the issue. Keep diffs tight.
3. Add focused unit tests for any non-trivial new behavior (especially security/correctness fixes). Tests live next to the source as *.test.ts.
4. Run \`pnpm --filter <pkg> lint\` and \`pnpm --filter <pkg> typecheck\` for the package(s) you touched, and \`npx vitest run --no-coverage <test-paths>\` for any test files you touched or added.
5. If an item is genuinely out of scope (architectural rework, needs design discussion, requires touching files you're told not to), defer it with a one-line reason.

Return ONLY the StructuredOutput tool call with the report. The main agent will update Todo.md from your structured findings.`;
}

// ============================================================================
// Phase 1 — Core API contract changes (must run first; providers/runners depend on it)
// ============================================================================
phase('Core+contract');

const items15_5 = `
- Replace hand-rolled \`zodToJSONSchema\` in packages/core/src/json-schema.ts with the \`zod-to-json-schema\` npm package (configure target jsonSchema7, $refStrategy none). Add it as a dep in packages/core/package.json. Currently throws UnsupportedZodTypeError for ZodLiteral/ZodUnion/ZodDiscriminatedUnion/ZodEffects/ZodAny/ZodUnknown/ZodTuple/ZodLazy — any plugin tool using .refine() or unions hits this at registration. Update json-schema.test.ts to cover the new cases. Keep the UnsupportedZodTypeError export for backward compat but stop throwing it from the package converter.
- Add \`toolChoice?: 'auto' | 'required' | 'none' | { name: string }\` and \`responseFormat?: { type: 'text' } | { type: 'json_object' } | { type: 'json_schema'; name?: string; schema: JSONSchema }\` to ChatRequest in packages/core/src/provider.ts. Do NOT add a parallel \`system?\` field — system prompts already flow through Message[] with role:'system'. Update providers in packages/provider-{anthropic,google,mistral,ollama,openai,openrouter,xai}/src/translate-request.ts to map the new fields per the comments in AUDIT-REPORT.md section 15.5 (Anthropic tool_choice, OpenAI tool_choice + response_format, Google toolConfig + responseMimeType/responseSchema, Ollama format:'json'). Providers that don't support a mode should silently pass through.
- Add \`reasoning?: boolean | { effort?: 'low'|'medium'|'high'; maxTokens?: number }\` to ChatRequest. Drop the \`req as unknown as { reasoning?, hasReasoning? }\` cast in packages/core/src/routing-provider.ts:167-173. Update packages/core/src/routing-provider.test.ts to set \`reasoning: true\` without the cast.
- Add \`reasoning?: boolean\` to modelCapabilitiesSchema in packages/core/src/capabilities.ts.
- Extend stopReasonSchema in packages/core/src/events.ts with 'cancelled' and 'content_filter'. Add \`code: z.enum(['rate_limit','auth','context_length','invalid_request','network','server','timeout','content_filter','cancelled','unknown'])\` to errorEventSchema. Add a helper \`mapHttpStatusToErrorCode(status, providerErrorType?)\` exported from core that providers can use to map their classification consistently.
- Fix collectSubagentResult in packages/core/src/runner.ts:
  (a) Lines 160-162: when AbortSignal fires, set stopReason='cancelled' (after extending SubagentStopReason if needed) instead of 'budget_exceeded'; preserve any existing 'error' stopReason; populate error with signal.reason ?? 'aborted'.
  (b) Lines 141-154: in the 'done' case, skip the stopReason assignment if \`error !== undefined\` or \`stopReason === 'error'\` already — make 'error' terminal-sticky.
  (c) Line 97: wrap the for-await in try/catch. On catch, set stopReason='runner_error', error = String(cause), flush still-pending tool_calls into toolEvents with isError:true, then return the accumulated SubagentResult (don't re-throw).
  (d) Lines 126-134: don't push orphan tool_result events with name=''. Either drop+log at warn level OR push with name=\`<orphan:\${evt.id}>\` and isError:true. Add a test in internal-runner.test.ts (or runner.test.ts).
- Add \`ToolCancelledError\` in packages/core/src/tool.ts as a sibling of ToolNotFoundError/ToolInputError. In ToolRegistry.execute (packages/core/src/tool-registry.ts:45-51), throw ToolCancelledError if \`ctx.signal.aborted\` BEFORE the Zod parse. Add a test asserting a pre-aborted controller never reaches tool.execute.
- Add optional \`dispose?(): Promise<void>\` to LLMProvider in packages/core/src/provider.ts. Document in JSDoc that ProviderRegistry consumers SHOULD await prev.dispose?.() when re-creating or shutting down.
- Document the budget-enforcement contract on SubagentRunner.run JSDoc in packages/core/src/runner.ts: runners are responsible for honoring opts.budget and SHOULD emit a terminal done with stopReason:'budget_exceeded' when any limit is hit.

If extending the test files surfaces real provider bugs (e.g., a provider drops the new tool_choice), document the bug and the call site but defer the implementation-bug fix to the provider's section (15.6) — keep this section bounded.
`;

const r15_5 = await agent(buildPrompt('15.5', items15_5), {
  label: '15.5 core+contract',
  phase: 'Core+contract',
  schema: REPORT_SCHEMA,
});

// ============================================================================
// Phase 2 — Everything else in parallel
// ============================================================================
phase('Parallel work');

const sections = [
  {
    id: '15.3',
    items: `
- Install a Content-Security-Policy on the renderer session (no CSP today). Wire via session.defaultSession.webRequest.onHeadersReceived OR an inline <meta http-equiv="Content-Security-Policy"> in index.html.
- Register app.on('web-contents-created', ...) handlers: will-navigate (block off-origin), setWindowOpenHandler (deny + shell.openExternal), setPermissionRequestHandler + setPermissionCheckHandler on session.defaultSession.
- Validate opencodex:// deep-link URLs before forwarding to renderer.
- registerInvoke (apps/desktop/src/main/ipc/registry.ts) should check event.senderFrame (must be the main frame) before dispatching.
- Wire apps/desktop/src/main/security/network-policy.ts into session.webRequest.onBeforeRequest so the allowlist is uniformly enforced — currently advisory.
- Empty allowlist silently means "allow all" — document on the type AND add a config-time warning in main/index.ts startup.
- Privacy-policy store: fail-closed instead of silently dropping to permissive defaults on corruption.
- Add isDestroyed() guard to emit() (broadcast() already has it).
- Recognise IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) in the network-policy host check.
`,
  },
  {
    id: '15.4',
    items: `
- packages/mcp-client/src/stdio-transport.ts: drain child.stderr (consume it) so chatty MCP servers don't block on the 64KB pipe buffer. Capture the last N KB and include in stop() diagnostics.
- Same file: scrub env handed to MCP servers — currently full process.env. Pass only the keys declared in the server config (or an explicit allowlist).
- HTTP/SSE transports (http-transport.ts, sse-transport.ts or equivalents): add a host allowlist. Reject 0.0.0.0, 169.254.169.254, link-local, anything not in the allowlist passed via config.
- Route server-initiated JSON-RPC requests ('sampling', 'elicit') — client can't dispatch them today, server hangs.
- Send notifications/cancelled on request timeout (server-side work currently leaks).
- HttpTransport: open the long-lived GET SSE channel for listChanged notifications.
- Add protocol-version negotiation on connect.
- Tighten the JSON-RPC message discriminator — a message with both \`result\` and \`method\` should not pass both isRequest and isResponse.
- Multi-listener onClose and onNotification (currently single-listener).
`,
  },
  {
    id: '15.6',
    items: `
- Every SSE reader (provider-{openai,anthropic,google,xai,mistral,openrouter}/src/sse-reader.ts or similar): flush the trailing event when the stream ends without \\n\\n.
- Same readers: call reader.cancel() on consumer break (HTTP connection leak otherwise).
- packages/provider-openai/src/translate-{request,response}.ts: handle Responses API messages with role:'tool' and string content (currently silently dropped) — coerce to a structured tool_result block.
- OpenAI tool_call delta keying: when 'index' field is omitted by an OpenAI-compatible server, fall back to keying by 'id'. Same fix for provider-openrouter and provider-xai which inherit the code.
- packages/provider-openrouter: capabilities() returns undefined for any model not in the static list — merge live listModels() results into the capability cache.
- packages/provider-google: map SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT finishReason to an error event with code:'content_filter' (currently maps to stop_sequence — policy blocks become silent empty turns).
- packages/provider-google: parseToolArgs wraps non-JSON string args in { value: <raw> } — instead reject with a clear error.
- packages/provider-google: wrapToolOutput preserves isError flag when output is a plain object.
- Populate costUsd in every provider's usage event when pricing is available.
- packages/provider-mistral: preserve cached_tokens from the response schema.
- packages/provider-mistral: coalesce mid-stream usage events instead of emitting one per chunk.
- Add retry/backoff helper in packages/core (called mapHttpStatusToErrorCode is fine if 15.5 added it; otherwise add Retry-After parsing + exponential backoff helper). Wire it into providers that emit retryable:true.
- Truncate raw response bodies in error messages to 4 KB and strip Authorization-shaped patterns.
- Validate API key format on construction — reject empty/whitespace; produce a clear error.
- Don't change KNOWN model arrays yet (live fetch is a separate item) — but if the change is trivial, add a comment with a TODO link.
- packages/provider-voyage: chat() throws — move it off the LLMProvider contract OR document the throw with a clear message.
- packages/provider-ollama: replace per-stream tool_call id counter with crypto.randomUUID() (currently collides across turns).
- JSON.stringify(output ?? '') across providers converts null → '""' — distinguish by checking output === null explicitly.
`,
  },
  {
    id: '15.7',
    items: `
- packages/runner-aider/src/runner.ts: stop auto-committing — add \`--no-auto-commits\` to the aider invocation (it currently uses \`--yes\` alone which lets aider commit). This bypasses OpenCodex's approval system.
- packages/runner-opencode/src/runner.ts: --headless and --message are not real opencode CLI flags. Audit against the real CLI; fix or remove.
- All three runners: on Windows, when the resolved binary is a .cmd/.ps1, use { shell: true } in spawn (currently fails with EINVAL).
- All three runners: scrubEnv strips every *_API_KEY + XDG_CONFIG_HOME, and stdio is 'ignore' — the CLIs can't authenticate. Pass through the user-configured keys (the manager already provides them via opts.env); close stdin properly (\`child.stdin?.end()\`) instead of using stdio:'ignore'.
- Expand Windows fallback path list beyond \`C:\\Program Files\\<name>\\<name>.exe\` — include %LOCALAPPDATA%\\\\Programs, scoop shims (~/.scoop/shims), npm-global, pipx \`%APPDATA%\\\\Python\\\\Scripts\`.
- Honor opts.budget?.maxWallTimeMs in all three runners.
- treeKill: await the SIGTERM before escalating to SIGKILL (currently fire-and-forget unref'd timer).
- Wake the abort loop when the AbortSignal fires (so consumer doesn't wedge until next yield).
- Add error handlers on child.stdout, .stderr, .stdin (currently only .on('error') which catches spawn errors).
- Strip ANSI escapes from stdio (use a small inline strip-ansi function; don't add a dep).
- Cap LineBuffer/NdjsonBuffer length (e.g. 1 MB) to prevent OOM on a runaway runner.
- packages/runner-aider: don't drop empty lines (LineBuffer preserves them — pass them through).
- packages/runner-aider: also pass \`--no-pretty --no-stream\` to prevent stalls in non-TTY.
- packages/runner-opencode: fallbackTextDelta mis-attributes stderr-ish lines as model text — drop the fallback or tag them explicitly (\`source: 'stderr'\`).
- Remove duplicated InstallCheck interface from each runner; import SubagentRunnerInstallCheck from @opencodex/core.
`,
  },
  {
    id: '15.8',
    items: `
- packages/crash-reporting: tearing down at runtime — when enabled flips to false in settings, call Sentry.close(). Today it stays initialized until next launch.
- packages/crash-reporting/src/scrub.ts (or wherever scrubEvent lives): walk event.exception (stack frames + frame.vars), event.breadcrumbs, event.contexts, event.tags, event.request (data/headers), event.message in addition to the current event.user / request.url / extra.
- packages/crash-reporting: initialize Sentry with explicit integrations:[<minimal list>] — disable default Net + Console + Breadcrumbs integrations (they capture LLM URLs and console payloads).
- Set tracesSampleRate: 0.1, sampleRate: 1.0, maxBreadcrumbs: 50. No 100% capture.
- Allowlist telemetry/crash hosts (posthog.com + self-hosted if user configures) — don't blindly send to whatever the user set.
- packages/telemetry: replace anonymizeId 32-bit non-crypto hash with HMAC-SHA-256 keyed by a per-install random salt stored via electron-store (or keytar).
- packages/telemetry: cap the event queue (drop-oldest at N events) when posthog-node fails to import/load.
- packages/telemetry: on load() failure, set a TTL before retrying instead of retrying on every track() call (the resolved=null + loading=null pattern is a thundering retry).
- packages/telemetry: pass distinctId through track() (today everything is hard-coded 'anonymous' so identify() is effectively dead).
- Use the exported zod schemas to parse the runtime config on construction inside each package (callers can pass garbage today).
- apps/desktop/src/main/crash/manager.ts: handle the asymmetric first-time enable/disable described in the audit — symmetric init/close on both transitions.
- Reject process.env.POSTHOG_API_KEY / SENTRY_DSN auto-pickup at startup — require explicit settings opt-in.
`,
  },
  {
    id: '15.9',
    items: `
- Create a shared bridge helper apps/desktop/src/renderer/bridge.ts that exposes a typed \`getBridge()\` returning \`window.opencodex | null\` with a console.warn when null. Convert the 13 unguarded sites (AppShell, ApprovalQueue, ActiveRunCard, AgentRunDrawer, AgentSpawnModal, AgentTreeView direct sites, BudgetSpendIndicator, CodebasePreviewPane, CodebaseSearchBox, CommandPalette, DraftPrModal, FileTree, JobsPane, McpHealthDashboard, McpMarketplacePanel, McpPermissionSurface, McpToolRunner, MergeConflictResolver, MergeReviewModal, EmbeddedTerminal) to use it. Pattern reference: AddToMemoryButton, MultiWorkspaceSelector.
- Fix MergeReviewModal: regenerateHunk currently receives runId where it should receive conversationId. Same modal passes repoRoot='.' to DraftPrModal and MergeConflictResolver — must be the actual workspaceRoot.
- Add a shared <Modal> wrapper at apps/desktop/src/renderer/components/Modal.tsx with focus trap (focus first focusable on mount, restore on close), Escape close, role=dialog/aria-modal, and inert background. Migrate at least 3 existing modals to use it (AgentSpawnModal, ApprovalQueue tab modal if any, DraftPrModal).
- Add a top-level React ErrorBoundary at apps/desktop/src/renderer/components/ErrorBoundary.tsx and wrap AppShell + each <Route> element with one. SettingsView.tsx:43 currently throws synchronously when SETTINGS_SECTIONS is empty — guard with a friendly fallback.
- Remove the global \`*:focus-visible { outline: none }\` rule from styles.css. Replace with targeted rules on components that fully implement their own focus indicator.
- Bump --text-muted and --text-faint to meet AA contrast in dark mode (run a contrast check; document the new HSL values in a comment).
- Define the missing --surface-2, --surface-3, --text-1, --text-2 CSS vars at the :root level so undefined references resolve.
- OnboardingWizard.tsx: lazy-load the ollama namespace check — wrap the OllamaStep useEffect window.opencodex.ollama.{probe, listInstallableManagers} calls in a guard that bails when the namespace is undefined.
- PluginSearchPanel: comment out the placeholder "install registry URL as filesystem path" code path until a real registry fetch is wired (or surface a "Registry not configured" UI).
- PluginPanelHost.toFileUrl: validate the path against PathEscapesWorkspaceError-style traversal.
- VoiceInputButton: replace ScriptProcessorNode with AudioWorkletNode; end recording on explicit click/pointerup (not pointerLeave).
- ScheduledTaskEditorModal: reset model state when provider changes.
- ScheduledTaskRunsDrawer: pause the 1Hz interval when no run is in-flight.
- ProviderSwitchButton: use a portal-aware click-outside hook.
- SettingsRail: scope the Cmd+F handler to focus-within instead of window-level.
- OnboardingBanner: re-mount the wizard instead of window.location.reload() (which wipes chat state).
- Scope global keydown listeners (1-6 in ApprovalQueue, a/r in MergeReviewModal, j/k in AgentRunDrawer) to focus-within the owning panel.
- AgentRunDrawer: depend the merge-bundle effect on \`run.id + run.mergeStatus + run.worktreeBranch\` instead of whole run object.
- Memoize Markdown component on input string.
- McpHealthDashboard: pick polling OR onChanged subscription, not both.
- FanoutConsentModal and AgentTreeView: cancel setInterval / async getWorktreePreview on unmount.
- AppShell: add a "Skip to main content" link as the first focusable element.
- ChatView, SettingsView, ReviewView: add a real <h1>.
- AutomationsView prefillSkill effect: add a cancellation flag.
- PrivacyPanel: depend useMemo on the right keys (currently snapshots window.opencodex.network and stales).
- UpdatesPanel: stable ref for check-ref.
- ChatView: move the seededInput setState out of render.
- SettingsView: clear the inner setTimeout on unmount.
- AgentRunRow: flatten the nested <button>.
- AgentSpawnModal: replace derived-state-in-render with useMemo.
- index.html: add <meta name="theme-color"> and an inline script that sets data-theme="dark|light" from prefers-color-scheme before first paint.
- AppShell grid-template-columns transition: animate width of the sidebar element instead (whole-app reflow today).
- styles.css: drop fixed-attached radial gradient + backdrop-filter on body (perf hotspot).
- appendDeltaBlock: avoid per-delta array allocation — batch in a small buffer flushed on next frame.
- useTransferConsumer: document the memoize requirement OR refactor to accept a ref.
- Rename references to a non-existent main.tsx in docs/tests if any; the entry is index.tsx.

This is a LOT for one agent — focus on the bridge helper + Modal + ErrorBoundary + the MergeReviewModal data-loss fix first; defer the rest with reasons. Aim for quality on the security/data-loss-class fixes.
`,
  },
  {
    id: '15.10',
    items: `
- apps/desktop/src/main/rag/multi-workspace-indexer.ts: onBatch only logs. Wire it end-to-end — chunk via @opencodex/rag-chunker, embed via the selected embedding provider (resolve via ProviderRegistry), upsert into LanceVectorStore. The audit found this is a totally unwired pipeline.
- apps/desktop/src/main/rag/vector-store.ts (LanceVectorStore): EITHER rename file/class to SqliteVectorStore and rename the file from \`lance.db\` to \`vectors.db\` (because it's actually SQLite), OR migrate to real LanceDB. Renaming is the cheap honest fix.
- searchByVector: add a simple inverted-index optimization (e.g. cluster by magnitude bucket) or document that it's O(N) and unfit beyond ~10K vectors.
- apps/desktop/src/main/rag/watcher.ts: setWatchedWorkspace must await close() on the prior watcher (currently leaks chokidar handles).
- watcher.ts: watch .gitignore itself (re-read on change) instead of reading once at start.
- Replace the custom glob parser used by the watcher/grep ignore matching with picomatch or minimatch.
- apps/desktop/src/main/git/handlers.ts (or wherever): scrub stderr from thrown errors (credential-helper URLs are leaking to renderer).
- draftPr: redact secret-shaped patterns from the diff before sending to the cloud LLM (use a regex set: AKIA, ghp_, sk-, "password":, etc.).
- openPrInBrowser: replace host.includes('github') with exact-match host === 'github.com' || host.endsWith('.github.com').
- branchFromConversation: validate baseRef with git check-ref-format; pass \`--\` separator to git so flag-shaped values can't slip through.
- Document submodule limitation explicitly in git/handlers.ts (full submodule support is a separate workstream).
- file-tree handler: stop claiming hasChildren=true for every directory — stat lazily on expand.
- file-tree handler: return \`{ entries, truncated: boolean }\` instead of silently capping at 500.
- file-tree handler: cache .gitignore reads (currently re-reads per IPC call).
- codebase:read-file: stream + slice instead of slurping the full file into memory before slicing.
- codebase.searchFilenames: add a depth limit and use the workspace .gitignore.
`,
  },
  {
    id: '15.11',
    items: `
- apps/desktop/src/main/scheduler/compute-next-fire.ts: add an optional tz parameter and use cron-parser's tz option. ScheduledTask schema gets an optional tz field.
- scheduler/scheduler.ts runCatchup: reset next_run_at after firing the catchup (currently leaves it stale).
- scheduler/scheduler.ts: surface missed-slot count after sleep/wake to telemetry as \`scheduler.missed_slots: N\`.
- scheduler/scheduler.ts: cap concurrent in-flight runs per task (currently \`* * * * *\` can stack unbounded).
- scheduler/scheduler.ts: handle setTimeout >24-day clamp by chaining timers or a wall-clock polling loop.
- Wrap the module-level scheduler state (running/timer/listTasksImpl/fireImpl + __resetForTests) in a Scheduler class so tests can't race.
- scheduler/scheduler.ts: persist a monotonic fire-log on every fire (so sub-minute drift after restart is observable).
- apps/desktop/src/main/triggers/git-hooks.ts: write the current scheduler-listener port to \`<workspace>/.git/hooks/opencodex-port\` and have the wrapper read it at runtime, instead of baking the port into the wrapper at install time.
- apps/desktop/src/main/triggers/listener.ts (or equivalent): cap or TTL the lastTriggerAt map.
- file-watcher debounce: include the changed file path in the debounced event payload.
- Replace the custom glob converter with picomatch (the \`**\` widening to \`.*\` is a real footgun).
- apps/desktop/src/main/skills/import.ts: refuse if HTTPS host is not in the configured skill-registry allowlist AND checksum doesn't match the registry entry.
- apps/desktop/src/main/skills/substitute.ts (or where {{arg_name}} interpolation happens): escape or fence args with a marker the model is taught to treat as data — minimal mitigation: wrap each substituted value in \`<arg name="x">...</arg>\` XML-ish tags.
- skills cron-auto-registration: when creating linked scheduled_tasks, leave provider/model unset (or use a marker meaning "current") so they re-resolve on each fire instead of pinning to sync-time selection.
- Onboarding: persist per-step state (objects keyed by step name) instead of a single \`complete\` boolean so a closed wizard resumes.
- pair/file-suggestions: sanitize CITATION_RE and BARE_PATH_RE matches — reject paths containing \`..\` segments and Windows backslash escapes.
`,
  },
  {
    id: '15.12',
    items: `
- packages/audit-verify/src/canonical.ts (or wherever canonicalJson lives): replace the partial canonicalization with a real JCS implementation OR include output_sha256 in the signed envelope so the signature covers a hash of canonical bytes rather than the bytes themselves. Update verifyAuditBundle accordingly. Add a test demonstrating that a no-op JSON reserialization still verifies.
- packages/audit-verify/bin/audit-verify.mjs and src/cli.ts: default to a pinned trust anchor instead of trusting the public key embedded in the bundle. Add \`--accept-embedded-pubkey\` flag for the audit's existing use case.
- packages/audit-verify/src/cli.test.ts: refactor bin/audit-verify.mjs to expose \`export async function main(argv, { stdout, stderr })\` returning an exit code. Replace the STUB_CLI substring assertions with synthetic argv calls + in-memory Writable streams. Keep one gated end-to-end test behind \`existsSync('dist/index.js')\`.
- audit-verify CLI: send --help output to stdout (not stderr); support stdin via \`-\` arg; reject flag-shaped values for --public-key; delete the dead base64-error-handling branch.
- apps/desktop/src/main/tool-audit/worm-mirror.ts: WORM is a no-op on Windows and not actually tamper-evident on POSIX. EITHER document the platform limitations honestly in the source AND a UI tooltip, OR use \`chattr +a\` on Linux + \`chflags uappnd\` on macOS (where supported).
- worm-mirror.ts setWormEnabled(true): wrap the openSync in try/catch (currently propagates uncaught when disk-full or permission-denied, leaving toggle inconsistent). Add a test.
- apps/desktop/src/main/storage/migrations.ts (or equivalent): refuse to open when schema_version > MAX_SUPPORTED with a clear "downgrade not supported" error.
- Apply withSqliteBusyRetry to conversation writes and applied-diffs writes (currently only on some paths).
- LIKE-escape in audit query vs export: pick one escape strategy and use it in both query.ts and export.ts.
- Document/fix the rebuildMessageFts test that's stale (appendMessage already auto-mirrors into messages_fts).
- apps/desktop/src/main/providers/catalog.ts: leave the static catalog but add a TODO comment with a link to the live-refresh plan; this is a v0.1 item, not v15.
- Same for Ollama listModels (use static catalog + TODO).
- apps/desktop/src/main/ollama/ollama-probe.ts: read base URL from the configured Ollama provider AND honor OLLAMA_HOST env; bump timeout to 3s; fall back to localhost on IPv6 connect failure.
- selected-model: add precedence (workspace > conversation > global) — a struct stored in settings with an explicit precedence resolver.
- On catalog refresh, detect missing models and clear the SelectedModel; surface a renderer toast.
- providers:save: clear lastTestResult and lastTestedAt when the API key changes.
- RoutingProvider.chat: when resolved provider isn't loaded, fall back to defaultRef and emit \`degradedReason: 'provider_missing'\` in the result.
- routing IPC: add isDestroyed() guard before webContents.send.
- ollama-installer.ts probeBinary: add a 5s spawn timeout.
- ollama-installer.ts curl-pipe-sh installer: SHA-256 checksum against the registry entry; single-flight (refuse concurrent invocations).
`,
  },
  {
    id: '15.13',
    items: `
- Create packages/memory-utils package OR a shared util inside packages/core (your choice — note your decision in summary) that exports atomicWrite, bm25, and snippet helpers. Replace the duplicated implementations in packages/memory-local-fs and packages/memory-obsidian with imports from the shared spot.
- Add per-file async mutex around read-modify-write in memory-local-fs and memory-obsidian (e.g. use a Map<filePath, Promise<void>> serializer).
- Atomic-write helpers (in the shared spot now): call fsync(fd) before rename, and fsync(dirfd) after rename. Use fs.open / fs.fsync from node:fs/promises.
- packages/memory-local-fs/src/markdown.ts: track fence depth in the heading parser so '## heading' inside a fenced code block doesn't create a phantom section. Add a test.
- packages/memory-local-fs: preserve source EOL (detect CRLF on read; preserve on write). Today CRLF is flattened to LF on every append.
- packages/memory-obsidian/src/path-guard.ts: realpath-check (same fix as packages/tools/src/path-guard.ts in 15.2 — but Obsidian's is purely lexical; mirror the resolveWithinWorkspace pattern).
- Obsidian createNote: use { flag: 'wx' } (O_CREAT|O_EXCL) on the open call instead of exists + atomic rename to avoid TOCTOU.
- Obsidian createNote: fix arg precedence — explicit \`title\` arg wins over \`extraFrontMatter.title\`.
- Front-matter serialization: switch to js-yaml (already likely transitive dep) or a small safe-yaml helper that quote-escapes values with quotes.
- packages/memory-notion: add retries + Retry-After-aware backoff on 429/5xx; max 3 retries; jitter.
- packages/memory-notion: paginate readPage (currently caps at 100 blocks) and search (currently caps at 25 results) using next_cursor.
- packages/memory-notion: createPage stops double-rendering the title (drop the prepended H1 OR drop the properties.title — keep one).
- packages/memory-notion: summarizeProperties: handle the full Notion property type set (number, select, multi_select, date, formula, relation, rollup, etc.) — at least don't drop them silently; emit \`{ type, raw }\`.
`,
  },
  {
    id: '15.14',
    items: `
- scripts/create-opencodex-plugin.mjs scaffold: fix the SubagentRunner.run() signature it emits — must match the actual @opencodex/core SubagentRunner contract (async generator yielding ChatEvent). Read the contract from packages/core/src/runner.ts to anchor it.
- examples/plugins/{hello-world,provider-stub,runner-stub,ui-panel}: their tsconfigs already got the noEmit fix in 15.2#3; verify dist/ now contains index.js for each. If any package.json types/main path doesn't exist, fix.
- packages/plugin-sdk: registerSlashCommand and registerProvider in the host or sdk currently drop their inputs. Wire them through — at minimum track them in the runtime state struct OR emit a clear unsupported error so authors learn early. Decide and document.
- packages/plugin-sdk/src/manifest.ts: enforce engines.opencodex against the host version at install time (in apps/desktop/src/main/plugins/manager.ts:installPluginFromPath). Throw a clear EngineMismatchError.
- packages/plugin-sdk/src/manifest.ts (entry, panels[].entry, slashCommands[].entry): require relative paths; reject absolute and any '..' segment. Add zod refinement.
- apps/desktop/src/main/plugins/manager.ts: add zod parses at the runtime boundary for the tool/provider/runner objects (in buildHost.registerX) — currently taken on trust despite the CLAUDE.md mandate.
- packages/plugin-sdk: replace randomUUID().slice(0, 8) plugin ID with the full UUID OR a content hash of the manifest.
- Scaffold: narrow default permissions to [] and document each (rather than pre-requesting agent.runner + workspace.write etc.).
- Scaffold: pin @opencodex/core dep to "workspace:*" if used inside the monorepo, OR to a real published version when one exists. Today it's ^0.1.0 which doesn't exist.
- packages/plugin-sdk/src/canonical.ts (or canonicalJson): add a version tag to the signed envelope (e.g. { v: 1, payload, sig }).
- Two of the four example plugins lack READMEs — add a minimal README.md (manifest + activate snippet + a one-line description).
- ContributionSchema and PermissionSchema: lock down the union to the documented set and add a test.
- examples/plugins/ui-panel: add a strict CSP <meta> tag to panel.html and document the iframe trust model (build on the audit-corrected wording).
`,
  },
  {
    id: '15.15',
    items: `
- .github/workflows/ci.yml: add a Playwright e2e step (gated on \`if: matrix.os == 'ubuntu-latest'\` to avoid Windows flakiness) — \`pnpm --filter @opencodex/desktop run e2e\`. Document that the desktop binary must be built first (already part of \`pnpm build\`).
- apps/desktop/e2e/smoke.spec.ts:7: change \`out/main/index.js\` to \`out/main/index.cjs\` (electron-vite emits .cjs).
- tsconfig.base.json: add path mappings for provider-voyage, runner-aider, runner-claude-code, runner-opencode (they're missing).
- .husky/pre-commit: switch the v9 deprecated wrapper to the v10-compatible format (drop the husky.sh shim).
- apps/desktop/electron-builder.yml: add Linux signing config (snap-store-creds or similar — accept an env var and pass through); add an explicit \`channel: latest\` to the autoupdater config; switch \`releaseType: draft\` to a clear flag the maintainer can flip (or add a separate "promote" workflow). Document.
- eslint.config.js: pick one stance on *.config.js/mjs (currently ignored) vs *.config.ts (typechecked) — make consistent. Recommend: lint config.ts files but ignore config.js/mjs (current state); document the intent in a top-of-file comment.
- package.json (root): re-order the test scripts so format:check runs BEFORE test (currently after) — format failures are cheap, surfacing them first saves CI minutes.
- apps/desktop/playwright.config.ts: add \`retries: 2\` and per-OS projects.
- apps/desktop/electron-builder.yml: ensure \`extraResources\` includes the runner dist/ outputs; if 15.2's build-runner-plugins.mjs change broke any path, fix it.
- .github/workflows/ci.yml: the rebuild-native step currently uses continue-on-error:true with a misleading "tests will be skipped" warning. Either drop continue-on-error (matches reality — sqlite IS load-bearing now via ensure-native-abi pretest) or write real \`describe.skipIf(!sqliteOk)\` gates. Drop continue-on-error is the cheaper honest fix.
- scripts/check-placeholders.mjs: tighten patterns to also catch \`lorem ipsum\`, \`xxx-xxx-xxx\`, and the standard "TODO:" / "FIXME:" markers in shipping doc files (but keep Todo.md, HANDOFF.md, AUDIT-REPORT.md, PLACEHOLDERS.md in allowlist). Add a test for the script.

Note: vitest.config.ts already has the right runner-* aliases NOT added (they're never imported as modules). Don't change vitest.config.ts.
`,
  },
  {
    id: '15.16',
    items: `
- MANUAL.md: rewrite the nav-rail / Settings / onboarding sections to match shipped reality. Reality: 7-item rail with Cmd+1..6 (the 7th doesn't have a shortcut OR Cmd+7 exists; verify by reading apps/desktop/src/renderer/components/AppShell.tsx); Runners is a top-level /runners route (NOT a Settings section); onboarding is 6 steps (verify against apps/desktop/src/renderer/components/OnboardingWizard.tsx); Settings has 19 sections including Routing, Privacy, Budgets — verify against apps/desktop/src/renderer/views/settings-sections.ts.
- MANUAL.md: the /settings/scheduled-tasks route redirects to /automations only; remove the /settings/scheduled-tasks mention.
- MANUAL.md Memory section: it lists "two backends" but local-fs ships now — update to three.
- MANUAL.md Settings → Indexing: expand beyond "chat-mode" (read the IndexingPanel.tsx to enumerate the real knobs).
- MANUAL.md: cite Cmd/Ctrl+P (Command Palette) alongside Cmd/Ctrl+, and Cmd/Ctrl+\\.
- MANUAL.md: note that Settings rail Cmd/Ctrl+F conflicts with Chat slash menu and Codebase search (15.9 has the fix; the doc should describe new behavior).
- README.md + CLAUDE.md: replace any \`packages/providers/\` reference with the actual flat layout (\`packages/provider-openai\`, etc.). Update the README package tree to include audit-verify, telemetry, crash-reporting, rag-chunker, runner-aider, runner-claude-code, runner-opencode, memory-local-fs.
- README.md dev setup: add \`pnpm typecheck\` to the build commands; mention check-placeholders as a precondition for tagging (now gated to release-readiness.yml).
- HANDOFF.md: align onboarding step count with MANUAL.md.
- SECURITY.md: expand "in-scope" to include runner adapters, memory backends, audit-verify, and the 127.0.0.1 scheduler webhook listener. Remove or replace the \`security@TODO-set-domain\` placeholder if you have authority to fill it; otherwise leave it and note it requires the maintainer's email.
- Todo.md: sweep "completed" items that the audit found are already done. DO NOT sweep Phase 15 — leave it for the main agent. Sweep older phases only.
- Remove the stray \`CUsersVRProjectsOPEN-UI-UX-handoff-fmt.tmp\` at repo root (it's a temp file artifact). Use Bash 'rm' (but if it's tracked, you may need git rm).
- RELEASE_NOTES_TEMPLATE.md: replace opencodex.dev reference per PLACEHOLDERS.md guidance (leave a placeholder if the domain is undecided, but clearly TODO so it shows up in placeholder check).
- Link unlinked docs/ files (release-signing, plugin-signing, plugin-registry, local-only-threat-model, security-model, positioning, provider-authoring) from a docs/README.md index (create if missing).
- .github/pull_request_template.md: fix the \`packages/providers/openai/__tests__/\` reference to the actual layout.
- website/package.json: align "name" with theme.config.tsx (both should be opencodex-docs OR both OpenCodex — pick one).
- website/theme.config.tsx: fix useNextSeoProps title template to not duplicate name on landing.
- website/theme.config.tsx: fix docsRepositoryBase if "Edit on GitHub" produces broken links.
- website/theme.config.tsx: configure useNextSeoProps description so every page has <meta name="description">.
- website/pages/*: fix any /building-a-runner trailing-slash inconsistency.
- runner-aider docs claim "non-streaming" — verify against packages/runner-aider/src/runner.ts and fix the doc OR the streaming:false flag in the runner.
- Nextra 2 → 3 migration is a separate workstream — DON'T do it, just add a docs/website/UPGRADE-NOTES.md noting useNextSeoProps removal in v3.
`,
  },
];

const r15_other = await parallel(
  sections.map(
    (s) => () =>
      agent(buildPrompt(s.id, s.items), {
        label: s.id,
        phase: 'Parallel work',
        schema: REPORT_SCHEMA,
      }).then((r) => ({ ...r, sectionId: s.id })),
  ),
);

const validResults = [r15_5, ...r15_other.filter(Boolean)];

return {
  sectionsRun: sections.length + 1,
  results: validResults,
};
