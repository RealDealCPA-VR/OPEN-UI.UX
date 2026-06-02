export interface SettingsSection {
  slug: string;
  title: string;
  description: string;
  /** Synonyms / related terms so search matches concepts a user might type
   *  even when those words aren't in the title or description. */
  tags?: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    slug: 'theme',
    title: 'Theme',
    description: 'Light, dark, or follow the OS preference. Applied immediately.',
    tags: ['appearance', 'dark mode', 'light mode', 'color', 'colour', 'look'],
  },
  {
    slug: 'workspace',
    title: 'Workspace',
    description:
      'Pick the folder the agent operates in. File-system tools (read, write, edit, glob, grep, run_shell) are sandboxed to this directory.',
    tags: ['folder', 'project', 'directory', 'path', 'cwd', 'repo'],
  },
  {
    slug: 'providers',
    title: 'Providers',
    description:
      'Add an API key to enable a provider. Keys are stored in your OS keychain; everything else lives in the local settings file.',
    tags: [
      'openai',
      'anthropic',
      'claude',
      'gpt',
      'gemini',
      'google',
      'grok',
      'xai',
      'mistral',
      'ollama',
      'openrouter',
      'voyage',
      'api',
      'key',
      'token',
      'llm',
      'model',
    ],
  },
  {
    slug: 'approvals',
    title: 'Approvals',
    description:
      'Control which tool calls run automatically, which ask first, and which are blocked. Tier defaults apply to every tool in that tier; per-tool overrides take precedence.',
    tags: ['permission', 'allow', 'deny', 'tier', 'consent', 'guard', 'safety'],
  },
  {
    slug: 'routing',
    title: 'Model routing',
    description:
      'Per-task model rules — route tool calls to a small model, reasoning to a frontier model, embeddings to local.',
    tags: ['route', 'rule', 'fallback', 'rule engine', 'dispatch', 'per-task'],
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    description:
      'Local Only mode + network allowlist + threat model. Block every non-loopback outbound request, or pin the agent to a small set of provider hosts.',
    tags: [
      'local only',
      'network',
      'firewall',
      'allowlist',
      'block',
      'air-gap',
      'offline',
      'secure',
    ],
  },
  {
    slug: 'plugins',
    title: 'Plugins',
    description:
      'Install third-party plugins from a local folder. Plugins can contribute tools, providers, and slash commands. They run in-process — only install plugins you trust.',
    tags: ['extension', 'addon', 'install', 'sdk', 'third-party', 'marketplace'],
  },
  {
    slug: 'mcp',
    title: 'MCP servers',
    description:
      'Model Context Protocol servers expose tools, resources, and prompts to the agent. Add a curated preset or paste a custom config — connections start automatically.',
    tags: ['mcp', 'model context protocol', 'integration', 'server', 'tool', 'resource'],
  },
  {
    slug: 'memory',
    title: 'Memory',
    description:
      'Long-term memory backends (Obsidian vault, Notion workspace) the agent can read and write across sessions.',
    tags: ['obsidian', 'notion', 'vault', 'notes', 'persistent', 'long-term', 'recall'],
  },
  {
    slug: 'updates',
    title: 'Updates',
    description:
      'Check for new releases automatically or on-demand. Updates are signed and delivered from the GitHub release feed.',
    tags: ['upgrade', 'release', 'version', 'check', 'auto-update'],
  },
  {
    slug: 'telemetry',
    title: 'Telemetry',
    description:
      'Opt-in anonymous usage metrics. Off by default. You provide the destination — nothing is sent anywhere unless you configure it.',
    tags: ['metrics', 'analytics', 'posthog', 'tracking', 'opt-in'],
  },
  {
    slug: 'crash-reporting',
    title: 'Crash reporting',
    description:
      'Opt-in crash report uploads. Off by default. Stack traces are scrubbed of file paths and user content before send.',
    tags: ['sentry', 'crash', 'error', 'report', 'stack trace', 'bug', 'opt-in'],
  },
  {
    slug: 'budgets',
    title: 'Budgets',
    description:
      'Per-conversation/day/month spending caps with warn + hard-stop. Always-visible in the status bar.',
    tags: [
      'cost',
      'spend',
      'spending',
      'limit',
      'cap',
      'threshold',
      'overage',
      'money',
      'price',
      'dollar',
      'usd',
      'token',
    ],
  },
  {
    slug: 'audit-log',
    title: 'Audit log',
    description:
      'Every tool call the agent runs is recorded here. Filter by tool, decision, result, or time range. Click a row to inspect the input and output.',
    tags: ['history', 'log', 'audit', 'trace', 'forensic', 'tool calls', 'review'],
  },
  {
    slug: 'replay',
    title: 'Replay & provenance',
    description:
      'Replay an applied diff against a different model, or export a signed provenance bundle (transcript + diffs + prompts + citations + routing decisions) for any conversation.',
    tags: ['replay', 'provenance', 'diff', 'reproduce', 'bundle', 'signed', 'ed25519', 'audit'],
  },
  {
    slug: 'indexing',
    title: 'Indexing',
    description: 'Codebase indexing for semantic search over your workspace.',
    tags: ['rag', 'embedding', 'search', 'vector', 'semantic', 'index', 'retrieval'],
  },
  {
    slug: 'scheduled-tasks',
    title: 'Scheduled tasks',
    description:
      'Cron-style schedules for unattended agent runs. Each task spawns a subagent with its own provider, model, allowed-tools whitelist, and (optionally) a git worktree for safe diff review.',
    tags: ['cron', 'schedule', 'automation', 'recurring', 'unattended', 'job', 'trigger'],
  },
  {
    slug: 'skills',
    title: 'Skills',
    description:
      'Reusable markdown prompt templates with frontmatter. Surface in chat as /skill:<name>. Skills can declare an allowed-tools whitelist and an optional cron schedule that auto-registers a scheduled task.',
    tags: ['template', 'prompt', 'recipe', 'snippet', 'slash command', 'reusable'],
  },
  {
    slug: 'accessibility',
    title: 'Accessibility',
    description:
      'Tune the UI for comfort. Toggle hover hints globally so contextual helper bubbles stay out of your way.',
    tags: ['a11y', 'tooltip', 'hint', 'comfort', 'screen reader', 'keyboard'],
  },
  {
    slug: 'help',
    title: 'Help',
    description:
      'User manual covering every screen, concept, shortcut, and common workflow. Searchable in the section rail above.',
    tags: ['manual', 'docs', 'documentation', 'guide', 'shortcuts', 'reference'],
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
    const tagsJoined = s.tags ? s.tags.join(' ') : '';
    const haystack = `${s.title} ${s.description} ${tagsJoined}`.toLowerCase();
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
