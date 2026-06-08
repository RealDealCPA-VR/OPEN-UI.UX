# Handoff State

## Last Session Summary

Goal: "make OpenCodex feel like the Claude desktop app — fan out an audit, produce the upgrades,
work them one at a time checking TS/lint." Ran a **7-dimension multi-agent audit** (8 agents, 57
findings) → synthesized a **21-item prioritized backlog** in
[docs/CLAUDE-DESKTOP-FEEL-PLAN.md](./docs/CLAUDE-DESKTOP-FEEL-PLAN.md), then implemented **all 21
(CD-01 … CD-21)** top-to-bottom, gating each on desktop typecheck + lint.

- **Design tokens (CD-01–03):** indigo → Claude clay/terracotta accent across both themes; warm
  cream/oat light surfaces + brown-tinted shadows; serif display stack on headings; defined the
  previously-undefined chip/citation tokens. WCAG AA verified.
- **Chat surface (CD-04–10):** styled empty-state greeting + starter chips; narrower reading
  measure + line-height; warm composer + clay Send; per-message hover actions (copy/retry/edit);
  blinking caret + thinking dots; collapsible `<think>` reasoning blocks; code/citation polish.
- **Conversations (CD-11–13):** LLM auto-title (opt-in flag) + `conversations:changed` broadcast +
  live sidebar; inline rename; star/pin (migration **v22** `starred`).
- **Features/chrome/polish (CD-14–21):** artifact preview side panel (html/svg/markdown, sandboxed
  iframe); prominent New Chat button; 2-zone nav rail; demoted/compact status bar; macOS
  hidden-inset titlebar + drag regions; popover scale-in + copy flourish; warmer onboarding;
  relative-time metadata + Cmd/K search focus.
- New unit tests: extract-thinking, auto-title, extract-artifacts, relative-time, + message-bubble
  memo comparator update.

## Verify Before Continuing

- [ ] **Gate (all green this session):** `pnpm -r typecheck` 0, `pnpm -r lint` 0, `pnpm test`
      2382 pass.
- [ ] **Known flakes only (NOT regressions):** the full-suite parallel run showed 5 failures, all
      Windows `EBUSY` temp-cleanup races in `checkpoints/manager.test.ts` (+ the documented
      `agent/git-init`, `agent/merge-review`, `stdio-transport`). All pass in isolation — re-ran
      `manager.test.ts`/`git-init`/`merge-review` together → **41/41 pass**.
- [ ] **better-sqlite3 ABI sentinel quirk (unchanged):** if DB tests throw `ERR_DLOPEN`, run
      `cd apps/desktop && pnpm rebuild better-sqlite3` (done once this session).
- [ ] **Needs a running app to validate (shipped but unverified headlessly):** the clay theme in
      light + dark; artifact iframe rendering; macOS hidden-inset titlebar; auto-title firing on a
      real first turn; conversation star/rename live-update.

## Next Task

Deferred sub-features (documented, each needs a running app or a new dependency):

1. **Windows/Linux frameless titlebar** with custom min/max/close controls (CD-18 shipped macOS only).
2. **Mermaid / JSX-TSX artifact rendering** (CD-14 ships html/svg/markdown; the rest needs
   mermaid + a JSX transpiler dependency).
3. **Projects with custom instructions** (CD-21 deferred this; star+rename cover most of the feel).

See `docs/CLAUDE-DESKTOP-FEEL-PLAN.md` for the full per-item implementation log.

## Context Notes

- Nothing was committed this session (tree left dirty for review, matching prior sessions).
- Keyboard ⌘1–6 mapping + shortcuts-catalog intentionally left unchanged in CD-16 (zones are
  visual-only) to avoid catalog/test churn.
- Carry-overs still true: Node 20 pinned; path has a space + period (`OPEN UI.UX`) — quote in shell;
  vitest runs from repo root.
