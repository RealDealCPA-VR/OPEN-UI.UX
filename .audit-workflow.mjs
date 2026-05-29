export const meta = {
  name: 'opencodex-codebase-audit',
  description:
    'Fan-out 20+ agents to audit OpenCodex monorepo for correctness, UX, a11y, security, perf, and test/build health; verify each finding adversarially; synthesize a prioritized report.',
  phases: [
    {
      title: 'Discover',
      detail: 'Parallel finder agents across packages, desktop main, renderer, build, docs, tests',
    },
    {
      title: 'Verify',
      detail: 'Adversarially verify each finding before it lands in the final report',
    },
    { title: 'Synthesize', detail: 'Group, dedupe, prioritize, and write the final report' },
  ],
};

// ---- shared finding shape -----------------------------------------------------------
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['area', 'findings'],
  properties: {
    area: { type: 'string', description: 'Area this agent covered, for grouping' },
    summary: { type: 'string', description: 'One paragraph overall takeaways for this area' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'category', 'location', 'problem', 'recommendation'],
        properties: {
          title: { type: 'string' },
          severity: { enum: ['critical', 'high', 'medium', 'low', 'nit'] },
          category: {
            enum: [
              'correctness-bug',
              'crash-risk',
              'security',
              'ipc-boundary',
              'data-loss',
              'ux',
              'accessibility',
              'perf',
              'memory-leak',
              'race-condition',
              'error-handling',
              'validation',
              'lint',
              'type-safety',
              'test',
              'build',
              'config',
              'docs',
              'dx',
              'dead-code',
              'inconsistency',
              'other',
            ],
          },
          location: {
            type: 'string',
            description: 'file_path:line_number (or file_path if no specific line)',
          },
          problem: { type: 'string', description: 'What is wrong, concrete' },
          recommendation: { type: 'string', description: 'Concrete fix' },
          confidence: { enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'Code snippet, error message, or repro' },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['isReal', 'severityAfterReview', 'reasoning'],
  properties: {
    isReal: { type: 'boolean', description: 'Is this a real, reproducible issue worth fixing?' },
    severityAfterReview: { enum: ['critical', 'high', 'medium', 'low', 'nit', 'invalid'] },
    reasoning: { type: 'string', description: 'Why this is or is not real, with evidence' },
    suggestedFix: {
      type: 'string',
      description: 'Refined fix if the original recommendation is off',
    },
  },
};

const ROOT = 'C:\\\\Users\\\\VR\\\\Projects\\\\OPEN UI.UX';

// ---- Discover ----------------------------------------------------------------------
phase('Discover');

const dimensions = [
  // ---------- Packages ----------
  {
    label: 'pkg:core',
    prompt: `Audit packages/core in the OpenCodex monorepo at ${ROOT}. Read packages/core/src/**/*.ts in full. This is the LLM provider abstraction, agent loop, and shared types — the contract everything depends on. Look for: (1) bugs in the agent loop (cancellation, stream handling, tool-call dispatch, message ordering, retries); (2) provider interface gaps (anything that forces providers into provider-specific hacks); (3) shared types that are too loose (any, unknown without Zod, missing discriminated unions, optional fields that should be required); (4) error handling holes (uncaught rejections in async iterators, swallowed errors, lost stack traces); (5) memory/perf risks (unbounded buffers, leaks, missing AbortSignal hookup); (6) any inconsistency with CLAUDE.md rules (no any, Zod at boundaries, noUncheckedIndexedAccess). Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:tools+mcp',
    prompt: `Audit packages/tools and packages/mcp-client at ${ROOT}. Read every src/*.ts file in both. tools = built-in tool registry surfaced to the agent. mcp-client = MCP server protocol client. Look for: (1) tool argument validation (Zod), tool result schema correctness; (2) MCP protocol handling — JSON-RPC framing, capability negotiation, error propagation, server lifecycle; (3) injection/path-traversal/command-injection risks in built-in tools (file read/write, shell, bash); (4) race conditions in concurrent tool calls; (5) MCP transport leaks (orphaned subprocesses, unclosed streams); (6) approval/permission integration. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:rag+audit-verify',
    prompt: `Audit packages/rag-chunker and packages/audit-verify at ${ROOT}. Read every src/*.ts. rag-chunker = code/markdown chunker for RAG indexing. audit-verify = Ed25519 signature verification CLI+lib for audit bundles. Look for: (1) chunker correctness — UTF-16 boundaries, multibyte handling, code-block boundary detection, off-by-one in line ranges; (2) audit-verify cryptographic correctness — signature canonicalization, timing-safe comparison, key parsing; (3) error handling on malformed input; (4) the CLI entrypoint bin/audit-verify.mjs — argument parsing, exit codes, stdin handling. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:plugin-sdk+examples',
    prompt: `Audit packages/plugin-sdk and examples/plugins/* at ${ROOT}. Read every src/*.ts in plugin-sdk and every file in examples/plugins/hello-world, provider-stub, runner-stub, ui-panel. This is the third-party plugin contract — it must be stable, well-typed, and safe. Look for: (1) plugin manifest schema gaps (capabilities, permissions, version constraints); (2) inadequate isolation between plugin and host (any leak, prototype pollution risk, eval, dynamic require); (3) inconsistency between examples and SDK (do examples use deprecated patterns?); (4) missing zod validation at the plugin boundary; (5) the create-opencodex-plugin script (scripts/create-opencodex-plugin.mjs at root) — usability and footguns. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:memory-backends',
    prompt: `Audit packages/memory-local-fs, packages/memory-notion, packages/memory-obsidian at ${ROOT}. Read every src/*.ts in all three. These are memory persistence backends. CRITICAL TEST FAILURE BASELINE: pnpm test cannot resolve @opencodex/memory-local-fs because its main points to dist/index.js but tests run pre-build — investigate whether this is a workspace-resolver bug or a missing "source"/"types-condition" in exports. Also look for: (1) markdown parse/write round-trip correctness; (2) atomic write safety (partial writes, crash mid-flush, lock files); (3) Notion API client robustness (rate limits, retries, schema drift); (4) Obsidian vault path safety. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:providers',
    prompt: `Audit ALL provider packages at ${ROOT}: packages/provider-anthropic, provider-google, provider-mistral, provider-ollama, provider-openai, provider-openrouter, provider-voyage, provider-xai. Read every src/*.ts in each (skim if large; deep-read the streaming/tool-use paths). Look for: (1) divergence in how each implements LLMProvider — capabilities one supports but others don't, inconsistent message-mapping; (2) streaming bugs — early-close handling, SSE parsing, partial JSON in tool args, token-counting; (3) tool-use schema translation between OpenAI-style and Anthropic-style; (4) API-key handling (logged? in errors? in retries?); (5) retry/backoff inconsistency; (6) hardcoded/stale model lists; (7) cost computation correctness; (8) auth header construction; (9) any provider-specific knowledge leaking into shared shapes. Report findings with file:line and tag each finding with which provider it applies to. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:runners',
    prompt: `Audit packages/runner-aider, packages/runner-claude-code, packages/runner-opencode at ${ROOT}. Read every src/*.ts. Runners are subprocess wrappers around external CLI coding agents. Look for: (1) subprocess lifecycle bugs — zombies, orphaned children on crash, missing kill on AbortSignal; (2) stdio parsing — assumption that lines come whole, encoding handling, ANSI stripping; (3) tool/event translation correctness; (4) cross-platform issues (Windows specifically — shell quoting, path separators, .cmd lookup); (5) auth/credential leakage in env or args; (6) flaky probe logic; (7) the runner discovery / install hint UX. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'pkg:telemetry+crash',
    prompt: `Audit packages/telemetry and packages/crash-reporting at ${ROOT}. Read every src/*.ts. Look for: (1) PII/secret leakage in events, crash dumps, breadcrumbs — does anything serialize raw prompts, API keys, file paths from the user's machine?; (2) opt-out actually working (does the off switch silence ALL emits?); (3) crash report symbolication and stripping; (4) telemetry sampling correctness; (5) the "no backend service" rule from CLAUDE.md — do these phone home? If so, to where, on what trigger?; (6) bounded buffers / drop policies under volume. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },

  // ---------- Desktop main ----------
  {
    label: 'main:agent+chat+replay',
    prompt: `Audit apps/desktop/src/main/agent, .../chat, .../replay at ${ROOT}. List the directories first, then read the key files. KNOWN FAILING TESTS to investigate root cause for: agent/run-store.test.ts, agent/runner-probe.test.ts, agent/spawn-from-ui.test.ts, chat/budget-manager.test.ts, chat/cost-comparison.test.ts, chat/file-preview.test.ts, chat/provider-switch.test.ts, chat/runner.test.ts, chat/system-prompt-builder.test.ts, replay/replay-engine.test.ts. Read the test files AND the modules they test — categorize each failure as test-only (mock missing, env setup) vs production bug. Also look for: cancellation race conditions, budget accrual atomicity, system prompt assembly correctness, replay determinism, run-store sqlite schema/migration safety. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'main:ipc+preload+security',
    prompt: `Audit apps/desktop/src/main/ipc, apps/desktop/src/main/security, apps/desktop/src/preload at ${ROOT}. Read every file. THIS IS THE ELECTRON SECURITY BOUNDARY — most critical area. Look for: (1) ipcMain handlers that take untrusted renderer input without Zod validation; (2) contextIsolation/sandbox/nodeIntegration settings (check apps/desktop/src/main/index.ts BrowserWindow creation); (3) preload exposing too-powerful APIs (raw fs, raw spawn, ipcRenderer.invoke direct); (4) path-traversal in file ops triggered from renderer; (5) command injection from renderer-supplied strings reaching spawn/exec; (6) approval/permission system bypass paths; (7) URL/origin checks for navigation/new-window; (8) CSP for renderer; (9) protocol handlers; (10) the security/ subsystem itself — is it actually enforced everywhere?. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'main:codebase+rag+filetree+git',
    prompt: `Audit apps/desktop/src/main/codebase, .../rag, .../file-tree, .../git at ${ROOT}. KNOWN FAILING TESTS: rag/multi-workspace-indexer.test.ts, rag/watcher.test.ts, rag/vector-store.test.ts. Read those tests and their modules. Also look for: (1) chokidar watcher lifecycle (unsubscribe on workspace switch, leak on rapid switching, .gitignore respect); (2) vector store correctness — dim mismatch, write-during-query, transactional safety; (3) git operations (libgit2 vs spawn?) — submodule handling, large repo behavior, secret exposure in diffs; (4) file-tree perf on large monorepos; (5) the codebase indexer's chunk pipeline — does it reuse @opencodex/rag-chunker? mismatch? Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'main:providers+model+routing+ollama',
    prompt: `Audit apps/desktop/src/main/providers, .../selected-model, .../routing, .../ollama at ${ROOT}. KNOWN FAILING TESTS: providers/catalog.test.ts, selected-model/resolve.test.ts. Read those tests and their modules — categorize each failure. Also look for: (1) the providers/catalog (model list, pricing, capabilities) — is it stale, hand-edited, where does it come from?; (2) selected-model resolve precedence — workspace > conversation > global, what happens when a model disappears?; (3) routing rules (auto-pick provider for a task) — does it leak keys, does it always succeed?; (4) ollama probing — port collisions, IPv6, listInstallableManagers (cross-reference renderer crash); (5) provider auth UX. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'main:scheduler+triggers+pair+onboarding+skills',
    prompt: `Audit apps/desktop/src/main/scheduler, .../triggers, .../pair, .../onboarding, .../skills at ${ROOT}. KNOWN FAILING TESTS: scheduler/compute-next-fire.test.ts, scheduler/file-watcher.test.ts, scheduler/scheduler.test.ts, scheduler/runner.test.ts, scheduler/store.test.ts. Read those tests and their modules. Also look for: (1) cron-parser correctness around DST, leap seconds, missed fires after sleep/wake, timezone handling; (2) scheduler durability — do scheduled tasks survive app crash/restart?; (3) triggers (file-watcher based) — debounce, glob safety, fan-out limits; (4) pair-programming mode — message ordering, cursor sync edge cases; (5) onboarding flow correctness — what happens if user closes mid-wizard? Resume state? (6) skills loading + sandboxing. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'main:storage+toolaudit+mcp+memory+plugins+misc',
    prompt: `Audit apps/desktop/src/main/storage, .../tool-audit, .../mcp, .../memory, .../plugins, .../shell, .../theme, .../crash, .../telemetry, .../review, .../selected-model, .../workspace at ${ROOT}. KNOWN FAILING TESTS: storage/applied-diffs.test.ts, storage/codebase-index.test.ts, storage/conversation-export.test.ts, storage/conversations.test.ts, storage/message-search.test.ts, storage/tool-audit.test.ts, tool-audit/audit-export.test.ts, tool-audit/audit-signing.test.ts, tool-audit/worm-mirror.test.ts, workspace/workspaces-store.test.ts. Read those tests and their modules. Also look for: (1) better-sqlite3 native-binding rebuild fragility (postinstall says it can be skipped — what happens then? crash on first sqlite call?); (2) migrations — backward compat, partial-failure recovery, schema-version locking; (3) WORM (write-once-read-many) mirror correctness — actual append-only? tamper-evident?; (4) audit signing pipeline; (5) shell subsystem on Windows; (6) theme application/persistence; (7) mcp server lifecycle from main side; (8) plugins loader sandboxing. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },

  // ---------- Renderer ----------
  {
    label: 'renderer:components-1',
    prompt: `Audit the FIRST HALF of apps/desktop/src/renderer/components at ${ROOT}: every .tsx in the components/ root folder, alphabetically A-M (ActiveRunCard.tsx through MultiWorkspaceSelector.tsx). For each non-test .tsx, look for: (1) missing window.opencodex.X null-check (KNOWN test failure pattern: components access window.opencodex.agent/.ollama/.X without guarding — crashes if preload is absent or partially loaded — root cause to investigate); (2) accessibility — missing aria-label, no keyboard focus management, missing role, color-only state, no focus trap on modals, missing prefers-reduced-motion; (3) UX bugs — loading state shown forever, error state without retry, optimistic update that never reconciles, race condition in useEffect cleanup; (4) React anti-patterns — derived state in useState, effect-as-callback, missing keys, stale closures, missing deps in useEffect; (5) perf — unmemoized expensive renders, re-render storms; (6) test coverage gaps for behavior shown in test files. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'renderer:components-2',
    prompt: `Audit the SECOND HALF of apps/desktop/src/renderer/components at ${ROOT}: every .tsx in the components/ root folder, alphabetically N-Z (OnboardingBanner.tsx through VoiceSettingsSection.tsx). Same checks as renderer:components-1: window.opencodex guards, a11y, UX bugs, React anti-patterns, perf. ALSO: deep-dive OnboardingWizard.tsx + OnboardingWizard.test.tsx — the test failure points at uncaught listInstallableManagers errors, which means OllamaStep is mounted but window.opencodex.ollama is undefined in jsdom. Is that a test setup gap or a real bug at runtime? Look at the components/onboarding/ subfolder. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'renderer:views+panes',
    prompt: `Audit apps/desktop/src/renderer/views/ (all .tsx) and apps/desktop/src/renderer/components/left-column-panes/ at ${ROOT}. These are top-level routes/views and side panes. KNOWN FAILING TEST: views/AutomationsView.test.tsx. Read views/SettingsView.tsx, ChatView.tsx, AgentView.tsx, CodebaseView.tsx, ReviewView.tsx, RunnersView.tsx in full. Look for: (1) routing/deep-link bugs; (2) settings-section registration drift (settings-sections.ts vs panels); (3) view-level error boundaries; (4) suspense fallbacks (or lack of); (5) accessibility for landmark structure, heading levels, skip-to-content; (6) settings panels that mutate global state from useEffect without cancellation. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'renderer:state+hooks+stores+assets+css',
    prompt: `Audit apps/desktop/src/renderer/state/, apps/desktop/src/renderer/hooks/, apps/desktop/src/renderer/stores/, apps/desktop/src/renderer/assets/, apps/desktop/src/renderer/index.html, apps/desktop/src/renderer/main.tsx, and the .css files at ${ROOT}/apps/desktop/src/renderer/components/*.css. Look for: (1) context providers with stable identity (every render new object → cascading re-renders); (2) Zustand/store setters that mutate state directly; (3) hook bugs (stale closures, missing cleanups); (4) global CSS leaking specificity, !important war, missing focus-visible styles, low color contrast; (5) layout/shift on initial render, missing reduced-motion guards. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },

  // ---------- Misc ----------
  {
    label: 'website',
    prompt: `Audit the Next.js docs site at ${ROOT}/website. Read website/package.json, website/next.config.mjs, website/theme.config.tsx, website/pages/**. Look for: (1) broken/dead internal links; (2) outdated content vs. CLAUDE.md / README.md / MANUAL.md; (3) missing pages for major features (skills, scheduler, plugins, MCP); (4) SEO basics (title, meta description, canonical); (5) accessibility (heading hierarchy, link text, contrast); (6) build/deploy footguns; (7) Nextra version drift. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'build+ci+config',
    prompt: `Audit the build/CI/config layer at ${ROOT}. Read: package.json (root), pnpm-workspace.yaml, eslint.config.js, vitest.config.ts, tsconfig.base.json, .github/**, .husky/**, .lintstagedrc.json, .prettierrc.json, apps/desktop/electron.vite.config.ts, apps/desktop/electron-builder.yml, apps/desktop/playwright.config.ts, apps/desktop/scripts/**, scripts/**. Look for: (1) tsconfig path mapping correctness vs workspace; (2) eslint rules vs CLAUDE.md (no any, ESM only); (3) CI matrix — does it cover Windows/macOS/Linux? does it actually run typecheck+lint+test+e2e?; (4) electron-builder publish config — code signing setup, autoupdate channels; (5) vitest config — is it the reason memory-local-fs/audit-verify don't resolve? (probably no "build first" step); (6) husky pre-commit completeness; (7) check-placeholders script — what's it for, does it block CI?; (8) the "postinstall" rebuild-native fallback — does CI handle it? Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'docs+todo+contributing',
    prompt: `Audit project docs at ${ROOT}: README.md, CLAUDE.md, MANUAL.md, HANDOFF.md, QUICKSTART.md, PLACEHOLDERS.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, RELEASE_NOTES_TEMPLATE.md, CODEOWNERS, LICENSE, docs/**, and Todo.md (long — sample sections). Look for: (1) instructions that no longer match the code (commands that don't exist, paths that moved, scripts renamed); (2) holes in install/build/test docs for new contributors; (3) MANUAL.md vs reality drift; (4) SECURITY.md adequacy for an Electron app; (5) Todo.md items that are silently already done; (6) Placeholders that escaped into shipped files (cross-reference check-placeholders script). Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
  {
    label: 'test-failure-deep-dive',
    prompt: `Deep-dive into the test failures in OpenCodex at ${ROOT}. Baseline: 14 suites failed to collect, 192 tests failed. ROOT CAUSES to verify: (A) "Failed to resolve entry for package @opencodex/memory-local-fs / @opencodex/audit-verify / monaco-editor" — these point main to dist/index.js but pnpm test doesn't build first. Check vitest.config.ts at root, check if there's an alias to src, check whether other workspace packages work because they expose dist OR because vitest finds source via tsconfig paths. Confirm by reading vitest.config.ts and a working vs broken package's package.json. (B) Mass "Cannot read properties of undefined (reading 'agent'|'ollama'|...)" — components access window.opencodex.X with no guard. Find where window.opencodex is supposed to be set up in tests (look for setupTests files, jsdom shim, mock of preload). Is there one global shim everyone forgot to include? (C) Suite-level failures in main/agent, main/chat, main/storage — likely better-sqlite3 native binding not built in test env, OR a shared in-memory-db helper that crashed. Read one failing test in each cluster to confirm. Read packages/tools/src/run-shell.test.ts — why does that fail? Read /tmp/test-clean.log if accessible (also at C:\\Users\\VR\\AppData\\Local\\Temp\\test-clean.log) — focus on the first uncaught exception per suite. Output findings categorized by root cause, with the smallest set of fixes that would unblock the most tests. Report findings with file:line. Return ONLY the StructuredOutput tool call.`,
  },
];

const findingsByArea = (
  await parallel(
    dimensions.map(
      (d) => () => agent(d.prompt, { label: d.label, phase: 'Discover', schema: FINDINGS_SCHEMA }),
    ),
  )
).filter(Boolean);

log(`Discovery returned ${findingsByArea.length}/${dimensions.length} areas with results`);
const totalFindings = findingsByArea.reduce((s, r) => s + (r.findings?.length || 0), 0);
log(`Total raw findings: ${totalFindings}`);

// ---- Verify ----------------------------------------------------------------------
phase('Verify');

// Build a flat list of (area, finding) pairs.
const allFindings = findingsByArea.flatMap((r) =>
  (r.findings || []).map((f, i) => ({ ...f, area: r.area, _idx: `${r.area}#${i}` })),
);

// Adversarial verify: each finding gets 1 skeptic that defaults to "not real" unless evidence is concrete.
// We skip verify for low/nit to save budget — they survive as-is with confidence downgraded.
const toVerify = allFindings.filter(
  (f) => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium',
);
const lowAndNit = allFindings.filter((f) => f.severity === 'low' || f.severity === 'nit');

log(
  `Verifying ${toVerify.length} findings (severity >= medium); passing ${lowAndNit.length} low/nit through unverified`,
);

const verified = await parallel(
  toVerify.map(
    (f) => () =>
      agent(
        `Adversarially verify this finding from an OpenCodex codebase audit. Read the cited file(s) at ${ROOT} and determine if the issue is REAL and worth fixing. Default to "not real" if the cited evidence is vague, the file doesn't match the description, or the recommendation is generic.

Finding:
- Title: ${f.title}
- Area: ${f.area}
- Severity (claimed): ${f.severity}
- Category: ${f.category}
- Location: ${f.location}
- Problem: ${f.problem}
- Evidence: ${f.evidence || '(none provided)'}
- Recommendation: ${f.recommendation}

Steps: open the cited file, find the cited lines, judge whether the problem actually exists as described. If severity is wrong (over- or under-stated), correct it. If the recommendation would not actually fix the problem, suggest a better one. Return ONLY the StructuredOutput tool call.`,
        { label: `verify:${f._idx}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ).then((v) => ({ finding: f, verdict: v })),
  ),
);

const confirmed = verified
  .filter((x) => x && x.verdict && x.verdict.isReal && x.verdict.severityAfterReview !== 'invalid')
  .map((x) => ({
    ...x.finding,
    severity: x.verdict.severityAfterReview || x.finding.severity,
    verifiedReasoning: x.verdict.reasoning,
    suggestedFix: x.verdict.suggestedFix || x.finding.recommendation,
  }));

const rejected = verified.filter(
  (x) => x && x.verdict && (!x.verdict.isReal || x.verdict.severityAfterReview === 'invalid'),
);

log(
  `Verified: ${confirmed.length} confirmed real, ${rejected.length} rejected/invalid, ${lowAndNit.length} low/nit passed through`,
);

// ---- Synthesize ----------------------------------------------------------------------
phase('Synthesize');

const allConfirmed = [...confirmed, ...lowAndNit];

return {
  totals: {
    areasAudited: findingsByArea.length,
    rawFindings: totalFindings,
    verifiedHigh: confirmed.filter((f) => f.severity === 'critical' || f.severity === 'high')
      .length,
    verifiedMedium: confirmed.filter((f) => f.severity === 'medium').length,
    lowAndNit: lowAndNit.length,
    rejected: rejected.length,
  },
  areaSummaries: findingsByArea.map((r) => ({ area: r.area, summary: r.summary })),
  confirmed: allConfirmed,
  rejected: rejected.map((x) => ({
    title: x.finding.title,
    area: x.finding.area,
    reasoning: x.verdict.reasoning,
  })),
};
