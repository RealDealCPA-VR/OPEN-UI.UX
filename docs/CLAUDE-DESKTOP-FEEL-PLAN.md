# Claude-Desktop Feel — Upgrade Plan

Goal: make OpenCodex _feel_ like Anthropic's Claude Desktop app. Produced by a 7-dimension
multi-agent audit (57 raw findings → 21 synthesized items). Implement top-to-bottom: design
tokens first (everything inherits from them), then the chat surface, then features, then chrome
and motion polish. Each item is gated on `pnpm -r typecheck` + `pnpm -r lint` before the next.

Baseline at start: typecheck 0, lint 0 (clean).

## Summary

OpenCodex today reads as cool "clean tech": cool-indigo accent (#5e5ce6/#7c7cff), cool-gray/white
light surfaces, sans-only type, a dense 7-item nav rail, an always-on developer status bar, and
several half-built surfaces (empty-state greeting, starter chips, citations) that reference
**undefined** CSS vars and render unstyled. The biggest gap is emotional/visual: the palette is
clinical, not warm/paper-like. Fix tokens first (warm clay accent + cream surfaces + serif display

- defined chip/citation vars); then the chat surface (reading measure, spacing, per-message hover
  actions, warm composer, streaming caret, thinking blocks); then local-friendly feel features
  (auto-title/rename/star conversations, artifact preview panel); then chrome simplification and a
  motion-polish pass.

## Backlog

| ID    | Title                                                         | Pri | Eff | Depends  |
| ----- | ------------------------------------------------------------- | --- | --- | -------- |
| CD-01 | Warm clay/terracotta accent across all themes                 | P0  | S   | —        |
| CD-02 | Warm cream/oat light-theme surfaces & shadows                 | P0  | S   | CD-01    |
| CD-03 | Serif display font for headings + define chip/citation tokens | P0  | S   | CD-01    |
| CD-04 | Style empty-state greeting + warmer starter chips             | P0  | S   | CD-02,03 |
| CD-05 | Reading measure, spacing & line-height for chat messages      | P1  | S   | —        |
| CD-06 | Warm composer framing + prominent clay Send button            | P0  | M   | CD-01,02 |
| CD-07 | Per-message hover actions (copy/retry/edit)                   | P0  | M   | CD-01    |
| CD-08 | Live streaming caret blink + thinking indicator               | P1  | S   | —        |
| CD-09 | Distinct, collapsible extended-thinking blocks                | P1  | M   | CD-01    |
| CD-10 | Code block + citation polish                                  | P1  | S   | CD-01,03 |
| CD-11 | Auto-title conversations after first reply                    | P1  | M   | —        |
| CD-12 | Inline rename of conversation titles                          | P1  | M   | CD-11    |
| CD-13 | Star/pin favorite conversations                               | P1  | M   | CD-01    |
| CD-14 | Sandboxed artifact preview side panel                         | P1  | L   | CD-05    |
| CD-15 | Prominent full-width New Chat button                          | P1  | M   | CD-01    |
| CD-16 | Slim nav rail to 2-zone content-first layout                  | P1  | L   | —        |
| CD-17 | Demote always-on developer status bar                         | P1  | M   | —        |
| CD-18 | Frameless / hidden-inset titlebar                             | P2  | M   | —        |
| CD-19 | Motion polish + prefers-reduced-motion coverage               | P1  | M   | —        |
| CD-20 | Warmer onboarding wizard + banner                             | P2  | M   | CD-01,03 |
| CD-21 | Conversation metadata + unified message search                | P2  | L   | CD-12,13 |

See the per-item upgradeSpec in the audit result for exact tokens/values. Implementation notes get
appended below as each item ships.

## Implementation log

- **CD-01..03 (tokens):** Swapped indigo → clay/terracotta accent ramp + all accent-derived
  tokens (selection/highlight/glow/bubble) in both themes. Warmed light surfaces to cream/oat,
  text to brown-neutral, shadows to warm-brown. Added `--font-serif` (system stack) on md h1–h3 +
  settings/empty headings. Defined the previously-undefined `--chip-*`/`--citation-*` tokens.
  WCAG AA verified (dark accent-text 8.79:1, light 4.77:1; faint nudged to clear 4.5).
- **CD-04 (empty state):** Added the missing CSS for `.chat-empty-state`/heading/sub/starter chips
  (markup + copy already existed but rendered unstyled). Serif greeting, clay chip hover.
- **CD-05 (reading):** Chat column 920→760px, bubble padding/gap up, `.chat-bubble-body` capped at
  680px + line-height 1.65 (scoped to chat; code blocks pin their own line-height).
- **CD-06 (composer):** Warm `--composer-bg` token (cream/charcoal), clay focus glow + lift,
  dedicated `.chat-send` primary-weight button class (no app-wide `.btn-primary` bloat).
- **CD-07 (message actions):** Hover/focus-revealed `.chat-bubble-actions`; assistant gets
  Copy + Regenerate, user gets Copy + Edit. `handleRegenerate` resends the preceding user turn via
  refs (stable identity, synced in effect — not during render, per lint rule). Memo comparator +
  test updated.
- **CD-08 (streaming):** Made the empty caret a real blinking bar; added pre-token animated
  `ThinkingDots` in the draft bubble.
- **CD-09 (thinking blocks):** No reasoning block type exists in core, so this targets the real
  case — reasoning models that emit inline `<think>/<thinking>/<reasoning>` tags. New
  `extract-thinking.ts` (+test, 9 cases) splits assistant text; collapsible `ThinkingBlock`
  (default collapsed, clay left-border, live-collapses unclosed tags mid-stream). Graceful no-op
  when no tags present.

Gate after each TS-touching item: desktop typecheck 0, lint 0, touched tests pass.

- **CD-10 (code/citation):** Lowercased 12px lang label, clay copy button, head/body contrast;
  citation padding. Removed a stale duplicate `.chat-starter-chip` block that overrode CD-04.
- **CD-11 (auto-title):** New `auto-title.ts` (LLM title via same provider/model, sanitized) +
  `conversations-events.ts` broadcaster + `conversations:changed` IPC + preload `onChanged` +
  renderer live-subscribe. Opt-in `autoTitle` flag (handler enables; runner tests unaffected).
  Pure-fn tests. Also rebuilt better-sqlite3 (documented ABI sentinel quirk) for the test DB.
- **CD-12 (rename):** Inline edit in ConversationRow (double-click / pencil), Enter/Esc, optimistic
  `renameConversation` in chat-context; backend already existed, broadcast keeps sidebar live.
- **CD-13 (star/pin):** Migration v22 `starred` column + partial index; `setConversationStarred`;
  list sorts starred-first; `conversations:setStarred` IPC (+ ipc-types); preload + optimistic
  `toggleStarConversation`; star button (always shown when starred). Fixed v19/v20 rollback-sim
  tests + Conversation mocks for the new field.

- **CD-14 (artifacts):** New `extract-artifacts.ts` (+test) detects previewable fenced blocks
  (html/svg/markdown); `ArtifactPanel.tsx` renders them in a collapsible right column —
  sandboxed iframe for html (`allow-scripts`) / svg, Markdown component for md — with
  copy/download/close + a header Preview toggle, width via `clamp()`, `useCollapseState`
  persistence. mermaid/jsx transpile deferred (would need a bundler/renderer dependency).
- **CD-15 (new chat):** Replaced the buried circular +-icon with a full-width clay primary
  "New Chat" button below the workspace header.
- **CD-16 (nav rail):** Added a `zone` field → primary (Chat/Agent/Codebase), divider, quieter
  tools (Runners/Reviewer/Automations), Settings pinned to the bottom. Array order + ⌘1–6 mapping
  left untouched, so no shortcut/catalog churn.
- **CD-17 (status bar):** Demoted to a compact default (shorter, dimmed metrics) that reveals full
  detail on hover/focus; a chevron pins it expanded (`useCollapseState`). All metrics preserved.
- **CD-18 (titlebar):** macOS `titleBarStyle: 'hiddenInset'` + drag regions + global `no-drag` on
  interactive elements. Windows/Linux keep their native frame (custom frameless controls need a
  running app to validate — deliberately not shipped blind).
- **CD-19 (motion):** Popover scale-in (`popover-enter`) on the floating menus; copy-button
  "copied" flourish. Found the global `prefers-reduced-motion` catch-all already nukes all
  animations/transitions (the audit's "only one element" claim was inaccurate) — a11y already covered.
- **CD-20 (onboarding):** Warmer banner copy ("You're almost ready", "Add an API key"), clay
  left-border banner, serif headings on the wizard/banner, italic "why" helper text.
- **CD-21 (metadata/search):** New `relative-time.ts` (+test) → "Just now / 3h ago / Yesterday /
  2w ago" with recency color-coding (today=clay, old=faint); Cmd/Ctrl+K focuses the existing
  conversation/message search.

## Result

All 21 items shipped. Full workspace gate green: `pnpm -r typecheck` 0, `pnpm -r lint` 0. New unit
tests added for the pure logic (extract-thinking, auto-title, extract-artifacts, relative-time) and
the message-bubble memo comparator. Deferred (need a running app / new deps, documented above):
Windows/Linux frameless titlebar, mermaid/JSX artifact rendering, and the Projects-with-instructions
sub-feature (star+rename already deliver most of the organizational feel).
