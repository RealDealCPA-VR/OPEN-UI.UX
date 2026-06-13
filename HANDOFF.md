# Handoff State

## Last Session Summary

Goal: "audit the entirety of this project and fix anything that is broken or doesn't look
visually nice." Audited both visual surfaces (Nextra docs site + Electron renderer) on top of the
already-green code gate.

- **Fixed (broken):**
  - **Docs landing was a hard 500.** `website/pages/index.mdx` used Nextra `<Cards>/<Card>`
    without importing them (`import { Cards, Card } from 'nextra/components'`) — these are not
    global MDX components in Nextra v2. Added the import; `next build` now prerenders all 14 pages
    static. This slipped through because `pnpm build` (= `pnpm -r build`) never builds the
    npm-managed website and `tsc --noEmit` can't see MDX runtime errors.
  - **CI gate gap:** added a `Build website` step to `.github/workflows/ci.yml` (runs `next build`
    in `website/`) so this class of MDX render bug can't ship silently again.
  - **Flaky test:** `AutomationsView.test.tsx` mocked the editor modal by pushing to `editorMounts`
    in the _render body_, so the host's `listTasks().then(setTasks)` resolving after the modal
    opened produced a 2nd render → `editorMounts.length === 2` under parallel load. Now counts
    _mounts_ via `useEffect(…, [])`. Full suite back to 274/274.
- **Fixed (visual / brand):** the app moved to a terracotta/clay palette but the website was still
  on the old indigo. Rebranded `website/styles/globals.css` (added a real `:root` + `html.dark`
  token block mirroring the app — the hero border/radius and `.eyebrow` had no definitions at all),
  `website/theme.config.tsx` (logo fill + `primaryHue`/`primarySaturation` so Nextra's own
  links/active-nav/search go copper).
- **Audited clean (no change needed):** renderer `styles.css` is token-rigorous — 0 undefined
  `var()` tokens across CSS _and_ `.tsx` inline styles (146 defined / 140 used); the 5-palette
  system (clay/indigo/ocean/emerald/violet) has complete light+dark blocks derived via `color-mix`.

## Verify Before Continuing

- [ ] **Gate (all green at handoff):** `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test`
      **274/274 files, 2587 passed / 8 skipped / 0 failed**, and **`cd website && npx next build`**
      exit 0 (14/14 static pages — this is NOT covered by `pnpm build`).
- [ ] Headless visual recheck (optional): Edge `--headless=new --screenshot` against `next dev`
      renders the docs faithfully. NB: `next dev` survives `TaskStop` of its wrapper — kill the real
      node PID on the port or `.next` stays locked and the next `next build` hangs on EPERM.

## Next Task

Still needs a **running Electron app** to verify (shipped typecheck/lint/test-clean, but headless):

1. Win32 frameless titlebar — overlay colors/height vs the 144px caption reservation, drag feel,
   theme-change recolor; linux WindowControls.
2. Fan-out consent modal round-trip (Allow/Deny from the renderer on first `spawn_subagent`).
3. Projects UI polish (create → assign → grouped header → instructions editor) and mermaid
   artifact visual render (lazy chunk, dark/default theme).
4. `tampered` plugin status badge — renderer shows `lastError` generically; no dedicated styling.

Remaining backlog (consciously deferred): LSP bridge real implementation (`pair/lsp-bridge.ts`
stub), subagent live streaming (`subagent.ts:234` TODO), JSX/TSX artifact transpile, tree-sitter
grammar .wasm bundling, plugin providers in the model picker, hero screenshot
(PLACEHOLDERS.md:69 — landing hero is still the SVG mock), 'window:maximized-changed' event.

## Context Notes

- The dirty working tree still includes the **prior** (2026-06-10) session's uncommitted fix waves
  in addition to this session's 5 source edits (ci.yml, AutomationsView.test.tsx,
  website/{index.mdx, globals.css, theme.config.tsx}). Nothing committed this session, matching the
  established convention (tree left dirty for review).
- Carry-overs still true: Node 20 pinned; path has a space + period (`OPEN UI.UX`) — quote in
  shell; vitest runs from repo root; better-sqlite3 ABI sentinel quirk
  (`pnpm rebuild-native-node`, NOT `rebuild-native`, for vitest DB tests).
