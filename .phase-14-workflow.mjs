export const meta = {
  name: 'phase-14-fanout',
  description:
    'Fan-out parallel agents to verify + ship the unchecked items in Todo.md Phase 14 (Go-to-product polish).',
  phases: [
    { title: 'Parallel work', detail: '14 agents covering Tier 1/2/3 subsections of Phase 14' },
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
    sectionId: {
      type: 'string',
      description: 'The Phase 14 subsection key, e.g. "tier1.git" or "tier2.replay"',
    },
    itemsCompleted: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'evidence'],
        properties: {
          title: { type: 'string', description: 'Verbatim from Todo.md' },
          alreadyShipped: {
            type: 'boolean',
            description: 'true if the feature was already present before this run',
          },
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
          reason: { type: 'string' },
        },
      },
    },
    filesModified: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    lintTypecheckOk: {
      type: 'object',
      required: ['lint', 'typecheck'],
      properties: {
        lint: { type: 'boolean' },
        typecheck: { type: 'boolean' },
        notes: { type: 'string' },
      },
    },
    summary: { type: 'string', description: '2-3 sentences' },
  },
};

const RULES = `
Project rules (CLAUDE.md):
- TypeScript strict + noUncheckedIndexedAccess. No \`any\`; use \`unknown\` + Zod at boundaries.
- ESM only. Kebab-case file names, PascalCase types, camelCase funcs/vars.
- Don't write WHAT-it-does comments — only WHY when non-obvious.
- Don't add features needing a hosted backend.

Phase 15 infrastructure that's already in place — do NOT change:
- vitest.config.ts aliases for @opencodex/*, monaco-editor stub, @opencodex/memory-utils
- apps/desktop/src/test/setup.ts (Proxy bridge shim + cleanup)
- apps/desktop/scripts/ensure-native-abi.mjs (better-sqlite3 ABI flipper)
- apps/desktop/src/main/storage/lazy-electron-store.ts (lazy Store)
- packages/tools/src/path-guard.ts (resolveWithinWorkspace is async — await it)
- packages/*/tsconfig.json (outDir:dist, rootDir:src, paths:{}) — dist/ emit works now
- apps/desktop/src/main/plugins/manager.ts UnsignedPluginRefusedError + TIER_TO_PERMISSION
- apps/desktop/src/renderer/bridge.ts getBridge() helper
- apps/desktop/src/renderer/components/{Modal,ErrorBoundary}.tsx
- SqliteVectorStore (was LanceVectorStore) — vectors.db, magnitude bucket prefilter
- Migrations v12 (agent_runs_persistent), v13 (messages_fts), v14 (workspaces + conversation_workspaces), v15 (applied_diffs) — already present in apps/desktop/src/main/storage/db.ts
- @opencodex/memory-utils package (atomicWrite, bm25, snippet, withFileLock)

Workflow:
1. For each item in your section, FIRST verify whether it's already shipped — search the cited paths + grep for symbol names + read relevant files. The Phase 15 docs sweep already checked off many items; don't double-check off but DO mark them as alreadyShipped:true in your report.
2. For genuinely unimplemented items, ship the smallest correct implementation:
   - Use the existing IPC pattern (registerInvoke + shared/ipc-types.ts)
   - Use the existing storage pattern (withSqliteBusyRetry + getDb())
   - Use the existing settings pattern (settingsStore + SettingsSchema in storage/settings.ts)
   - Use the existing renderer bridge pattern (window.opencodex.X via getBridge())
3. Add a focused unit test next to the new code (*.test.ts).
4. Run \`pnpm --filter <pkg> typecheck\` and \`pnpm --filter <pkg> lint\` for what you touched.
5. Return ONLY the StructuredOutput tool call.

DO NOT modify Todo.md — the main agent will check items off from your structured report.
DO NOT run \`pnpm build\`, \`pnpm install\`, or any package-manager mutation.
DO NOT \`git commit\` or \`git push\`.
DO NOT touch files outside your scope.

If your section depends on something another section provides (e.g., a new IPC channel, a new shared type), feel free to add the type/channel yourself — the merge will be one of last-writer-wins on duplicates, which we'll handle in the final verify pass.
`;

function buildPrompt(sectionId, items, scope) {
  return `Phase 14 Section ${sectionId} at ${ROOT}.

${RULES}

YOUR SCOPE (files you may touch): ${scope}

YOUR ITEMS (verbatim from Todo.md Phase 14):
${items}

Begin.`;
}

// ============================================================================
// 14 sections in parallel
// ============================================================================
phase('Parallel work');

const sections = [
  {
    id: 'tier1.zero-friction-first-run',
    scope:
      'apps/desktop/src/renderer/components/OnboardingWizard.tsx + onboarding/* + ChatComposer/related composer files + apps/desktop/src/main/onboarding/* + storage/settings.ts (only the OnboardingState region)',
    items: `
- [ ] Add a "Try with local Ollama" path to apps/desktop/src/renderer/components/OnboardingWizard.tsx — detect a running Ollama via 127.0.0.1:11434/api/tags (use the existing ollama-probe.ts via window.opencodex.ollama.probe); otherwise offer one-click install through the Phase 13 runner-install pipeline (apps/desktop/src/main/ollama/ollama-installer.ts).
- [ ] If Ollama is present, default to the smallest installed chat-capable model (smallest by param count or first in /api/tags result), and pre-create a workspace pointing at the user's home directory (use os.homedir()) so the first run lands in a working chat without a key.
- [ ] "Skip provider setup" action that activates Ollama-only mode (set selectedModel to first Ollama model + writes onboardingComplete=true via settingsStore).
- [ ] One-time inline tip in the chat composer the first time a non-Ollama provider is configured: "Cloud provider — your prompts leave the machine". Persist a dismissed flag in settings.

Notes: "Ollama-only mode" already overlaps with LocalOnlyPill (15.10/Phase 14 Tier 3); reuse the localOnlyMode network policy if convenient.
`,
  },
  {
    id: 'tier1.speed',
    scope:
      'apps/desktop/scripts/* (new bench.mjs allowed), .github/workflows/ci.yml (perf step only), apps/desktop/src/main/index.ts (only document sync fs spots; do not refactor), apps/desktop/src/renderer/views/ChatView.tsx, apps/desktop/src/renderer/state/chat-context.tsx',
    items: `
- [ ] Renderer perf budget enforced in CI: cold-start under 1500ms (from app.ready to first paint of ChatView), keystroke-to-token under 50ms p95 in apps/desktop/src/renderer/views/ChatView.tsx.
- [ ] pnpm bench script that boots the packaged app headlessly and records both metrics as a JSON artifact; CI fails on >10% regression vs main.
- [ ] Audit main process for synchronous fs work on the event loop (apps/desktop/src/main/index.ts, apps/desktop/src/main/storage/); move bounded work to worker_threads.
- [ ] Profile streaming under high token rate; ensure no React re-renders larger than the appended delta in ChatView.tsx.

For the perf-budget items: ship a working "pnpm bench" script (apps/desktop/scripts/bench.mjs) that uses Playwright + Electron to capture the two metrics into a JSON file under apps/desktop/.bench/<timestamp>.json. Add a small CI step. The "fails on >10% regression" can be a TODO comment for now — ship the measurement infrastructure first. Don't move main-process work to worker_threads; just produce an audit doc at docs/perf-audit.md listing the sync calls you find with file:line.
`,
  },
  {
    id: 'tier1.diff-review',
    scope:
      'apps/desktop/src/renderer/components/{MergeReviewModal,MonacoDiffViewer,monaco-diff-helpers,ApprovalQueue}.tsx and apps/desktop/src/main/git/* (regenerate-hunk IPC)',
    items: `
- [ ] Promote MonacoDiffViewer.tsx from approval-modal opt-in to the default review surface in apps/desktop/src/renderer/components/MergeReviewModal.tsx; toolbar toggle for side-by-side vs unified.
- [ ] Per-hunk keyboard accept/reject in the diff viewer: a accept, r reject, j/k next/prev hunk; reuse monaco-diff-helpers.ts getLineChanges().
- [ ] Per-hunk "Regenerate with different instruction" button — inline composer scoped to that hunk; submits to the same provider with the surrounding context and replaces only that hunk on accept. The handler IPC (apps/desktop/src/main/chat/handlers.ts:regenerateHunk or similar) may already exist; wire the renderer side.
- [ ] "Why?" disclosure per hunk revealing: the user prompt, the tool call that produced the change, the retrieved RAG context (file:line citations), the model + cost — sourced from the existing tool_calls audit row + run-registry timeline.

Note: 15.9 already migrated MergeReviewModal to the shared Modal wrapper and fixed the runId-as-conversationId bug. Build on top.
`,
  },
  {
    id: 'tier1.cost-jobs-search-git',
    scope:
      'apps/desktop/src/renderer/views/ChatView.tsx (per-conversation budget UI) + apps/desktop/src/renderer/components/JobsPane.tsx + apps/desktop/src/main/agent/{run-registry,run-store,run-resume}.ts + apps/desktop/src/main/storage/{conversations,message-search}.ts + apps/desktop/src/main/git/* (already largely shipped — verify) + apps/desktop/src/main/chat/budget-handlers.ts + apps/desktop/src/shared/budgets.ts',
    items: `
- [ ] Per-conversation budget override button in chat header. Wire a small inline form (max-spend + warn-pct) that calls budgets:create with conversationId scope. Reuse BudgetSpendIndicator for the live display.
- [ ] Jobs panel in the unified left column when on /agent: every active subagent run with live token meter, current tool, cost, Cancel button — survives app restarts. JobsPane.tsx exists; add agent_runs_persistent backing + a Cancel button that calls window.opencodex.agent.abortRun.
- [ ] Persistent agent_runs table mirrored from in-memory run-registry.ts so resumability works across restarts (migration v12 — already present in db.ts as agent_runs_persistent). Wire run-store.ts to mirror state into agent_runs_persistent.
- [ ] Resume contract on app.ready: runs with status='running' and a worktree get a "Resume" or "Discard" prompt; runs without a worktree are marked 'crashed'. Wire from apps/desktop/src/main/agent/run-resume.ts and surface via existing AgentResumePrompt.tsx.
- [ ] FTS5 virtual table over conversation messages (migration v13 — already present as messages_fts in db.ts) populated incrementally on insert in apps/desktop/src/main/storage/conversations.ts (verify the auto-mirror works on appendMessage). Add a conversations:search-messages IPC that returns top-N matches with snippet().
- [ ] "Open in conversation" jumps to the matching message and scrolls it into view. Wire a renderer-side handler in CommandPalette.tsx or wherever search results render.
- [ ] Verify the four git-workflow items are shipped (branch-from-conversation, commit-selected-hunks, draft-PR, merge-conflict view) — files exist per 15.10. If "merge-conflict view" (apps/desktop/src/renderer/components/MergeConflictResolver.tsx) is referenced but absent or stubbed, flesh it out.

If anti-sycophancy is a separate concern, the next agent owns it — don't touch orchestrator-prompt.ts.
`,
  },
  {
    id: 'tier1.anti-sycophancy',
    scope:
      'apps/desktop/src/main/agent/orchestrator-prompt.ts + apps/desktop/src/main/chat/system-prompt-builder.ts + apps/desktop/src/main/storage/settings.ts + apps/desktop/src/renderer/views/ApprovalsPanel.tsx (or SkillsPanel) + apps/desktop/src/renderer/components/AntiSycophancyToggle.tsx (already exists per 15.10/15.11 work — wire it)',
    items: `
- [ ] Explicit anti-sycophancy clause appended to apps/desktop/src/main/agent/orchestrator-prompt.ts and the default chat system prompt: "If the user's premise is wrong, say so before doing the task. Disagree when you have grounds. Do not optimize for the user feeling validated."
- [ ] Settings toggle in Approvals or Skills to disable the clause for users who want it off; default on. AntiSycophancyToggle.tsx may already exist; verify wiring through anti-sycophancy-handlers.ts (already exists per main/agent/anti-sycophancy-handlers.ts).
`,
  },
  {
    id: 'tier2.workspaces-routing',
    scope:
      'apps/desktop/src/main/workspace/* + apps/desktop/src/main/rag/multi-workspace-indexer.ts + apps/desktop/src/renderer/components/{MultiWorkspaceSelector,ChatContextPane}.tsx + apps/desktop/src/main/storage/workspaces-store.ts + packages/tools/src/search-codebase.ts (workspace filter only) + apps/desktop/src/main/routing/* (audit log only) + apps/desktop/src/main/tool-audit/* (routing decision row only)',
    items: `
- [ ] workspaces table (migration v14 — already present as workspaces + conversation_workspaces in db.ts) — verify workspaces-store.ts has CRUD; if missing, ship it.
- [ ] apps/desktop/src/main/rag/multi-workspace-indexer.ts — verify it keeps an index per workspace under <userData>/rag/<workspaceId>/ (15.10 wired the end-to-end pipeline; this item is about the persisted layout).
- [ ] Workspace picker in ChatContextPane.tsx becomes multi-select — conversation targets one primary workspace and pulls RAG from any subset of secondaries. Use conversation_workspaces table.
- [ ] search_codebase tool gains a workspace filter; retrieved chunks render with a workspace badge so the user sees which repo each hit came from. Extend the Zod input schema in packages/tools/src/search-codebase.ts (or wherever it lives) with workspaceIds: z.array(z.string()).optional(). Add a workspaceId on returned chunks.
- [ ] Cross-workspace dependency follow-up — when a retrieved chunk in workspace A references a symbol defined in workspace B, surface that as a follow-up retrieval. Ship a small heuristic: after the initial search, for each top-K result, if the chunk contains an import-like pattern (import / require / use) referencing a path that resolves into another enabled workspace, push that into a "related" array in the result. Be conservative.
- [ ] Every routed call carries the routing decision into the audit log so users see which model handled what. RoutingDecision already has fields per 15.12 (provider_missing degradedReason). Wire RoutingDecision into the tool_calls audit row OR add a new column to tool_calls (migration v16) OR write into the existing decision JSON field. Choose the lowest-friction path.
`,
  },
  {
    id: 'tier2.mcp-integration',
    scope:
      'apps/desktop/src/renderer/components/{McpMarketplacePanel,McpPermissionSurface,McpHealthDashboard,McpToolRunner,CommandPalette}.tsx + apps/desktop/src/main/mcp/* (manager, presets, extra-handlers, handlers)',
    items: `
- [ ] MCP marketplace panel — fetches a curated list (start with apps/desktop/src/main/mcp/presets.ts, extend with a remote JSON registry) and renders each server as a card with one-click install. McpMarketplacePanel.tsx exists — verify it works; ship the fetch + install flow if missing.
- [ ] Per-server permission surface — visible grants ("can read your filesystem", "can call GitHub on your behalf") with a revoke button. McpPermissionSurface.tsx exists — wire to an IPC that lists the actual capability strings the server advertised (host the data on the per-server state in apps/desktop/src/main/mcp/manager.ts).
- [ ] MCP server health dashboard — last-seen, reconnect count, recent errors per server. McpHealthDashboard.tsx exists — wire to manager's per-server status object.
- [ ] "Run MCP tool" command-palette entry — execute any MCP tool directly without a chat round-trip. CommandPalette.tsx + McpToolRunner.tsx exist; wire the palette command to open McpToolRunner with the chosen tool prefilled.
`,
  },
  {
    id: 'tier2.replay-provenance',
    scope:
      'apps/desktop/src/main/replay/* + apps/desktop/src/main/storage/applied-diffs.ts + apps/desktop/src/renderer/components/{ReplayConversationModal,ReplayDiffCard,ProvenanceBundleExporter}.tsx + apps/desktop/src/main/storage/conversation-export.ts',
    items: `
- [ ] Every applied diff records: full prompt, retrieved RAG citations, routing decision, model, token count, cost, optional seed — extends tool_calls plus a new applied_diffs table (migration v15 — already present). Verify the applied-diffs.ts file fully exists and the row schema captures all those fields; expand if needed.
- [ ] "Replay this conversation" on conversation header — clones the conversation, lets the user swap provider/model, replays every user message, diffs the final output against the original. ReplayConversationModal.tsx + apps/desktop/src/main/replay/replay-engine.ts exist; verify and complete.
- [ ] "Replay this diff" on every diff card — same with finer granularity. ReplayDiffCard.tsx exists; verify.
- [ ] Export provenance bundle as JSON for a single conversation — for code review and compliance attachments. ProvenanceBundleExporter.tsx exists; wire a conversations:export-provenance IPC that builds the bundle (signed via audit-signing.ts — reuse the per-install Ed25519 key from Phase 14 / Phase 13 audit signing).
`,
  },
  {
    id: 'tier2.pair-voice-reviewer',
    scope:
      'apps/desktop/src/renderer/components/SuggestionsPane.tsx + apps/desktop/src/main/pair/* + apps/desktop/src/main/voice/* + apps/desktop/src/renderer/components/VoiceInputButton.tsx + apps/desktop/src/main/review/* + apps/desktop/src/renderer/components/ReviewFindingCard.tsx + docs/privacy.md (or section in docs/security-model.md) + apps/desktop/src/renderer/views/SettingsView.tsx (Voice section only)',
    items: `
- [ ] All Pair suggestions are passive: shown in a "Suggestions" pane in the chat sidebar, dismissed individually, never auto-applied, never push-notified. SuggestionsPane.tsx exists — verify it renders the suggestions from pair:notify and never auto-applies.
- [ ] Voice transcript appears in the composer as it's recognized; user can edit before sending; never auto-sends. Wire VoiceInputButton.tsx to the existing voice/manager.ts events; insert recognized text into the active composer field.
- [ ] No cloud STT in v1; document the local-only stance in the Privacy section of the docs. Append to docs/security-model.md or create a docs/voice-privacy.md.
- [ ] Optional gh integration — "Post selected findings as PR comments" with explicit per-finding confirmation; no silent posting. Reuse the gh shell pattern from apps/desktop/src/main/git/draft-pr.ts.
- [ ] Every Reviewer finding shows the prompt + retrieved context that produced it so the reviewer can audit the AI's reasoning. ReviewFindingCard.tsx exists — extend the data shape via apps/desktop/src/main/review/review-engine.ts to capture {prompt, retrieved} and expose it in the card.
`,
  },
  {
    id: 'tier2.plugins-memory-mission-control',
    scope:
      'apps/desktop/src/renderer/components/{PluginSearchPanel,AddToMemoryButton,AgentTreeView,ActiveRunCard,FanoutConsentModal,AgentRunRow}.tsx + apps/desktop/src/main/plugins/* (registry fetcher only) + apps/desktop/src/main/memory/* + apps/desktop/src/main/agent/* (tree handlers + fan-out consent)',
    items: `
- [ ] In-app plugin search — searches the registry by name, contribution type, permissions; one-click install through the existing consent flow. PluginSearchPanel.tsx + apps/desktop/src/main/plugins/registry-fetcher.ts exist; wire end-to-end via plugins:fetch-registry IPC then plugins:install-from-path (using the consent dialog from 15.2's UnsignedPluginRefusedError flow).
- [ ] On workspace switch, the active memory.md content is prepended to the system prompt (size-capped, configurable via settings.memorySystemPromptMaxBytes default 4096). Wire from apps/desktop/src/main/chat/system-prompt-builder.ts.
- [ ] "Add to project memory" action on any assistant response — appends a heading + content to memory.md via the existing memory-local-fs backend. AddToMemoryButton.tsx exists — wire it.
- [ ] New AgentView mode: "Tree" — visualizes parent + child runs as a tree with live token meter, current tool, cost per node; clicking a node opens its run drawer. AgentTreeView.tsx + agent-tree-derive.ts exist — verify.
- [ ] Per-node Abort and Pause (Pause stops the next tool turn without killing the worktree). Wire abort to existing abortRun IPC; add a new agent:pause-run IPC that sets a 'paused' flag on the run; the runner loop checks it before each tool call.
- [ ] Orchestrator surfaces fan-out decisions inline ("About to fan out 3 subagents for: A, B, C — proceed?") with Allow / Edit / Deny; defaults to Allow after a configurable delay so existing flows don't slow down. FanoutConsentModal.tsx exists — verify.
- [ ] Per-subagent worktree preview in the tree view — Monaco diff snippet for the largest in-progress change. Hook into the existing prepareMergeBundle output exposed via AgentTreeView.bridge.getWorktreePreview.
`,
  },
  {
    id: 'tier3.audit-provider-switch',
    scope:
      'apps/desktop/src/main/tool-audit/* + apps/desktop/src/renderer/views/AuditLogPanel.tsx + apps/desktop/src/renderer/components/ProviderSwitchButton.tsx + apps/desktop/src/renderer/views/ChatView.tsx (header only) + apps/desktop/src/main/chat/provider-switch-handlers.ts',
    items: `
- [ ] Audit filters for "all tool calls touching <file>" or "all tool calls by runner X between dates" for compliance + post-incident review. Extend the audit query in apps/desktop/src/main/storage/tool-audit.ts with filePath and runnerId filter params (both indexed already by 15.12). Wire UI in AuditLogPanel.tsx.
- [ ] Optional WORM (write-once) mode mirroring the audit log to a second file with append-only fs permissions. apps/desktop/src/main/tool-audit/worm-mirror.ts already exists per 15.12 with the platform-honest disclaimer; verify nothing else is needed.
- [ ] "Switch provider" as a prominent action in the chat header — single click, retains conversation history, re-sends only what the new provider needs. ProviderSwitchButton.tsx exists — verify it's actually mounted in ChatView's header and the resendStrategy (full-history vs summary-only) is wired.
- [ ] Reframe README, MANUAL, and website landing around provider-agnostic posture as a first-class feature. The "Mission Control framing" items (next section) overlap — leave reframes to the docs agent.
`,
  },
  {
    id: 'positioning.docs',
    scope:
      'README.md + MANUAL.md + website/pages/index.mdx + website/pages/* + docs/positioning.md',
    items: `
- [ ] Rewrite the README, MANUAL, and website landing around "Mission Control for AI coding agents" — the architecture already lives there (Phase 9 runners, multi-agent orchestration, MCP-native, plugin SDK); the marketing surface doesn't reflect it yet.
- [ ] Landing hero screenshot is the subagent tree view from the Mission Control item above, not a single chat screenshot. (You can't take screenshots; instead, add a TODO + the spec in PLACEHOLDERS.md OR an svg placeholder asset that says "subagent tree view screenshot — TODO".)
- [ ] Positioning copy: standalone desktop that lives next to your editor and drives Claude Code / Aider / OpenCode as runners alongside the built-in agent.
- [ ] (Tier 2 Plugin SDK ecosystem) Plugin registry as a JSON manifest in a separate opencodex-plugins GitHub repo; OpenCodex fetches it from the pluginRegistryUrl setting (already wired) — document the registry schema in docs/plugin-registry.md (already exists per 15.2 docs sweep) and the publish flow in CONTRIBUTING.md.
- [ ] (Tier 3 Provider-switch as a marketed first-class feature) Reframe README, MANUAL, and website landing around provider-agnostic posture as a first-class feature.

Scope discipline: only docs/markdown/MDX. Don't touch code.
`,
  },
];

const results = await parallel(
  sections.map(
    (s) => () =>
      agent(buildPrompt(s.id, s.items, s.scope), {
        label: s.id,
        phase: 'Parallel work',
        schema: REPORT_SCHEMA,
      }).then((r) => (r ? { ...r, sectionId: s.id } : null)),
  ),
);

return {
  sectionsRun: sections.length,
  results: results.filter(Boolean),
};
