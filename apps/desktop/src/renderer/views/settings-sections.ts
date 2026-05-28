export interface SettingsSection {
  slug: string;
  title: string;
  description: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    slug: 'theme',
    title: 'Theme',
    description: 'Light, dark, or follow the OS preference. Applied immediately.',
  },
  {
    slug: 'workspace',
    title: 'Workspace',
    description:
      'Pick the folder the agent operates in. File-system tools (read, write, edit, glob, grep, run_shell) are sandboxed to this directory.',
  },
  {
    slug: 'providers',
    title: 'Providers',
    description:
      'Add an API key to enable a provider. Keys are stored in your OS keychain; everything else lives in the local settings file.',
  },
  {
    slug: 'approvals',
    title: 'Approvals',
    description:
      'Control which tool calls run automatically, which ask first, and which are blocked. Tier defaults apply to every tool in that tier; per-tool overrides take precedence.',
  },
  {
    slug: 'plugins',
    title: 'Plugins',
    description:
      'Install third-party plugins from a local folder. Plugins can contribute tools, providers, and slash commands. They run in-process — only install plugins you trust.',
  },
  {
    slug: 'mcp',
    title: 'MCP servers',
    description:
      'Model Context Protocol servers expose tools, resources, and prompts to the agent. Add a curated preset or paste a custom config — connections start automatically.',
  },
  {
    slug: 'memory',
    title: 'Memory',
    description:
      'Long-term memory backends (Obsidian vault, Notion workspace) the agent can read and write across sessions.',
  },
  {
    slug: 'updates',
    title: 'Updates',
    description:
      'Check for new releases automatically or on-demand. Updates are signed and delivered from the GitHub release feed.',
  },
  {
    slug: 'telemetry',
    title: 'Telemetry',
    description:
      'Opt-in anonymous usage metrics. Off by default. You provide the destination — nothing is sent anywhere unless you configure it.',
  },
  {
    slug: 'crash-reporting',
    title: 'Crash reporting',
    description:
      'Opt-in crash report uploads. Off by default. Stack traces are scrubbed of file paths and user content before send.',
  },
  {
    slug: 'audit-log',
    title: 'Audit log',
    description:
      'Every tool call the agent runs is recorded here. Filter by tool, decision, result, or time range. Click a row to inspect the input and output.',
  },
  {
    slug: 'indexing',
    title: 'Indexing',
    description: 'Codebase indexing for semantic search over your workspace.',
  },
  {
    slug: 'scheduled-tasks',
    title: 'Scheduled tasks',
    description:
      'Cron-style schedules for unattended agent runs. Each task spawns a subagent with its own provider, model, allowed-tools whitelist, and (optionally) a git worktree for safe diff review.',
  },
  {
    slug: 'skills',
    title: 'Skills',
    description:
      'Reusable markdown prompt templates with frontmatter. Surface in chat as /skill:<name>. Skills can declare an allowed-tools whitelist and an optional cron schedule that auto-registers a scheduled task.',
  },
  {
    slug: 'runners',
    title: 'Runners',
    description:
      'Manage agent runners and CLI paths. Built-in runs in-process; plugin runners shell out to external harnesses with their own provider, tools, and approvals.',
  },
  {
    slug: 'accessibility',
    title: 'Accessibility',
    description:
      'Tune the UI for comfort. Toggle hover hints globally so contextual helper bubbles stay out of your way.',
  },
  {
    slug: 'help',
    title: 'Help',
    description:
      'User manual covering every screen, concept, shortcut, and common workflow. Searchable in the section rail above.',
  },
] as const;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function filterSettingsSections(
  sections: readonly SettingsSection[],
  query: string,
): SettingsSection[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...sections];
  return sections.filter((s) => {
    const haystack = `${s.title} ${s.description}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function findSectionBySlug(
  sections: readonly SettingsSection[],
  slug: string | undefined,
): SettingsSection | null {
  if (!slug) return null;
  return sections.find((s) => s.slug === slug) ?? null;
}

export const DEFAULT_SETTINGS_SLUG: string = SETTINGS_SECTIONS[0]?.slug ?? 'theme';
