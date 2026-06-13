export interface ShortcutEntry {
  id: string;
  keys: string;
  label: string;
  scope: ShortcutScope;
}

export type ShortcutScope =
  | 'navigation'
  | 'palette'
  | 'composer'
  | 'approval'
  | 'fileTree'
  | 'merge'
  | 'modal'
  | 'settings';

export interface ShortcutGroup {
  scope: ShortcutScope;
  title: string;
  description: string;
  entries: ShortcutEntry[];
}

export const SHORTCUTS_CATALOG: readonly ShortcutGroup[] = [
  {
    scope: 'navigation',
    title: 'Navigation',
    description: 'Move between the seven top-level views.',
    entries: [
      { id: 'nav-chat', keys: 'Ctrl/⌘ 1', label: 'Open Chat', scope: 'navigation' },
      { id: 'nav-agent', keys: 'Ctrl/⌘ 2', label: 'Open Agent', scope: 'navigation' },
      { id: 'nav-runners', keys: 'Ctrl/⌘ 3', label: 'Open Runners', scope: 'navigation' },
      { id: 'nav-codebase', keys: 'Ctrl/⌘ 4', label: 'Open Codebase', scope: 'navigation' },
      { id: 'nav-review', keys: 'Ctrl/⌘ 5', label: 'Open Reviewer', scope: 'navigation' },
      { id: 'nav-automations', keys: 'Ctrl/⌘ 6', label: 'Open Automations', scope: 'navigation' },
      { id: 'nav-settings', keys: 'Ctrl/⌘ ,', label: 'Open Settings', scope: 'navigation' },
      {
        id: 'nav-collapse',
        keys: 'Ctrl/⌘ \\ or Ctrl/⌘ B',
        label: 'Toggle left column',
        scope: 'navigation',
      },
      {
        id: 'nav-conversation-search',
        keys: 'Ctrl/⌘ K',
        label: 'Focus conversation search (Chat view)',
        scope: 'navigation',
      },
    ],
  },
  {
    scope: 'palette',
    title: 'Command palette',
    description: 'Search messages, files, skills, MCP tools — and trigger actions.',
    entries: [
      { id: 'palette-open', keys: 'Ctrl/⌘ P', label: 'Open command palette', scope: 'palette' },
      { id: 'palette-nav', keys: '↑ ↓', label: 'Move selection', scope: 'palette' },
      { id: 'palette-open-entry', keys: 'Enter', label: 'Open selected entry', scope: 'palette' },
      { id: 'palette-close', keys: 'Esc', label: 'Close palette', scope: 'palette' },
    ],
  },
  {
    scope: 'composer',
    title: 'Chat composer',
    description: 'Compose, send, and recall messages in the chat input.',
    entries: [
      { id: 'composer-send', keys: 'Enter', label: 'Send message', scope: 'composer' },
      { id: 'composer-newline', keys: 'Shift Enter', label: 'Insert newline', scope: 'composer' },
      {
        id: 'composer-recall',
        keys: '↑',
        label: 'Recall last message (when input is empty)',
        scope: 'composer',
      },
      {
        id: 'composer-slash',
        keys: '/',
        label: 'Open slash commands (skills + MCP prompts)',
        scope: 'composer',
      },
      {
        id: 'composer-cancel',
        keys: 'Esc',
        label: 'Cancel in-flight stream',
        scope: 'composer',
      },
    ],
  },
  {
    scope: 'approval',
    title: 'Approval queue',
    description: 'Decide tool calls when an approval modal is open.',
    entries: [
      { id: 'approval-allow-once', keys: '1', label: 'Allow once', scope: 'approval' },
      { id: 'approval-deny-once', keys: '2', label: 'Deny once', scope: 'approval' },
      { id: 'approval-allow-session', keys: '3', label: 'Allow this session', scope: 'approval' },
      { id: 'approval-deny-session', keys: '4', label: 'Deny this session', scope: 'approval' },
      { id: 'approval-always-allow', keys: '5', label: 'Always allow', scope: 'approval' },
      { id: 'approval-always-deny', keys: '6', label: 'Always deny', scope: 'approval' },
    ],
  },
  {
    scope: 'fileTree',
    title: 'File tree',
    description: 'Browse files in the Codebase view.',
    entries: [
      { id: 'tree-up', keys: '↑ / k', label: 'Previous node', scope: 'fileTree' },
      { id: 'tree-down', keys: '↓ / j', label: 'Next node', scope: 'fileTree' },
      { id: 'tree-expand', keys: '→', label: 'Expand directory', scope: 'fileTree' },
      { id: 'tree-collapse', keys: '←', label: 'Collapse directory', scope: 'fileTree' },
      { id: 'tree-open', keys: 'Enter / Space', label: 'Open file in preview', scope: 'fileTree' },
    ],
  },
  {
    scope: 'merge',
    title: 'Merge review',
    description: 'Inspect and approve subagent diffs from the merge-review modal.',
    entries: [
      { id: 'merge-next', keys: 'j', label: 'Next hunk', scope: 'merge' },
      { id: 'merge-prev', keys: 'k', label: 'Previous hunk', scope: 'merge' },
      { id: 'merge-accept', keys: 'a', label: 'Accept hunk', scope: 'merge' },
      { id: 'merge-reject', keys: 'r', label: 'Reject hunk', scope: 'merge' },
    ],
  },
  {
    scope: 'settings',
    title: 'Settings',
    description: 'Filter and jump within the Settings view.',
    entries: [
      {
        id: 'settings-search',
        keys: 'Ctrl/⌘ F',
        label: 'Focus section search (Settings only)',
        scope: 'settings',
      },
    ],
  },
  {
    scope: 'modal',
    title: 'Modals & menus',
    description: 'Universal modal controls.',
    entries: [
      { id: 'modal-close', keys: 'Esc', label: 'Close modal or dismiss menu', scope: 'modal' },
      {
        id: 'modal-tab',
        keys: 'Tab / Shift Tab',
        label: 'Move focus within modal',
        scope: 'modal',
      },
      {
        id: 'shortcuts-show',
        keys: '?',
        label: 'Open this keyboard shortcuts overlay',
        scope: 'modal',
      },
    ],
  },
] as const;

export function filterShortcuts(
  groups: ReadonlyArray<ShortcutGroup>,
  query: string,
): ShortcutGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...groups];
  const out: ShortcutGroup[] = [];
  for (const g of groups) {
    const matched = g.entries.filter((e) => {
      const haystack = `${e.label} ${e.keys} ${g.title}`.toLowerCase();
      return haystack.includes(q);
    });
    if (matched.length > 0) {
      out.push({ ...g, entries: matched });
    }
  }
  return out;
}
