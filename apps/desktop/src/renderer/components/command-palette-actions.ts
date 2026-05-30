import type { NavigateFunction } from 'react-router-dom';
import { SETTINGS_SECTIONS } from '../views/settings-sections';
import type { PaletteAction } from './command-palette-derive';

export interface ActionContext {
  navigate: NavigateFunction;
  openShortcuts: () => void;
}

/** Build the full list of palette actions for the current shell context.
 *  Actions are filtered by the user query inside mergePaletteResults. */
export function buildPaletteActions(ctx: ActionContext): PaletteAction[] {
  const { navigate, openShortcuts } = ctx;

  const baseActions: PaletteAction[] = [
    {
      id: 'open-shortcuts',
      title: 'Show keyboard shortcuts',
      subtitle: 'Open the cheatsheet overlay',
      keywords: ['help', 'cheatsheet', 'keys', 'hotkeys', '?'],
      perform: openShortcuts,
    },
    {
      id: 'toggle-theme',
      title: 'Toggle theme',
      subtitle: 'Cycle light / dark / system',
      keywords: ['theme', 'dark', 'light', 'appearance', 'mode'],
      perform: () => {
        window.dispatchEvent(new CustomEvent('opencodex:theme:toggle'));
      },
    },
    {
      id: 'goto-chat',
      title: 'Go to Chat',
      subtitle: 'Open the chat view',
      keywords: ['chat', 'conversation', 'message', 'talk'],
      perform: () => navigate('/chat'),
    },
    {
      id: 'goto-agent',
      title: 'Go to Agent runs',
      subtitle: 'See active and completed subagent runs',
      keywords: ['agent', 'subagent', 'run', 'task'],
      perform: () => navigate('/agent'),
    },
    {
      id: 'goto-runners',
      title: 'Go to Runners',
      subtitle: 'Configure CLI runner adapters',
      keywords: ['runners', 'aider', 'claude', 'opencode', 'cli'],
      perform: () => navigate('/runners'),
    },
    {
      id: 'goto-codebase',
      title: 'Go to Codebase',
      subtitle: 'Browse the active workspace',
      keywords: ['codebase', 'files', 'tree', 'workspace', 'project'],
      perform: () => navigate('/codebase'),
    },
    {
      id: 'goto-review',
      title: 'Go to Reviewer',
      subtitle: 'Diff-based code review',
      keywords: ['review', 'diff', 'reviewer', 'changes'],
      perform: () => navigate('/review'),
    },
    {
      id: 'goto-automations',
      title: 'Go to Automations',
      subtitle: 'Scheduled tasks and recurring agents',
      keywords: ['automations', 'cron', 'scheduled', 'tasks', 'recurring'],
      perform: () => navigate('/automations'),
    },
    {
      id: 'new-chat',
      title: 'New chat',
      subtitle: 'Start a fresh conversation',
      keywords: ['new', 'chat', 'conversation', 'start'],
      perform: () => {
        navigate('/chat');
        window.dispatchEvent(new CustomEvent('opencodex:chat:new'));
      },
    },
    {
      id: 'reload-skills',
      title: 'Reload skills',
      subtitle: 'Rescan ~/.opencodex/skills for changes',
      keywords: ['skills', 'reload', 'refresh', 'scan'],
      perform: () => {
        window.dispatchEvent(new CustomEvent('opencodex:skills:reload'));
      },
    },
  ];

  // One action per Settings section so users can jump straight to any of them.
  const settingsActions: PaletteAction[] = SETTINGS_SECTIONS.map((section) => ({
    id: `settings-${section.slug}`,
    title: `Settings: ${section.title}`,
    subtitle: truncate(section.description, 96),
    keywords: ['settings', 'preferences', section.slug, section.title.toLowerCase()],
    perform: () => navigate(`/settings/${section.slug}`),
  }));

  return [...baseActions, ...settingsActions];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
