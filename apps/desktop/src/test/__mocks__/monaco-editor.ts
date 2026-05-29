// Empty stub for `monaco-editor` so vitest can resolve the package.
//
// The real package declares only `module:` (no `main:`) in its package.json, which
// makes Vite's Node resolution hard-error in test mode. MonacoDiffViewer and
// CodebasePreviewPane import `monaco-editor` at runtime via lazy dynamic import,
// and (`import type { editor }`) at the type level — neither path actually runs
// in unit tests since jsdom doesn't render Monaco; this stub just satisfies the
// resolver.

export const editor: Record<string, unknown> = {};
export default {};
