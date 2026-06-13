import type { McpPromptEntry } from '../../shared/mcp';
import type { PluginSlashCommandDescriptor } from '../../shared/plugins';
import type { Skill } from '../../shared/skills';

export interface SlashCommandTrigger {
  query: string;
  start: number;
}

export type SlashEntry =
  | { kind: 'mcp'; entry: McpPromptEntry }
  | { kind: 'skill'; skill: Skill }
  | { kind: 'plugin'; command: PluginSlashCommandDescriptor };

export interface SlashGroup {
  header: string;
  badge?: string;
  entries: SlashEntry[];
}

export function getSlashTrigger(value: string, caret: number): SlashCommandTrigger | null {
  if (caret < 1 || caret > value.length) return null;
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === undefined) return null;
    if (ch === '/') {
      const before = i === 0 ? '' : value.slice(0, i);
      const lineStart = before.lastIndexOf('\n') + 1;
      if (i !== lineStart) return null;
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query)) return null;
      return { query, start: i };
    }
    if (ch === '\n' || ch === ' ' || ch === '\t') return null;
    i--;
  }
  return null;
}

export function filterPrompts(
  entries: ReadonlyArray<McpPromptEntry>,
  query: string,
): McpPromptEntry[] {
  if (entries.length === 0) return [];
  const q = query.trim().toLowerCase();
  if (q === '') return [...entries];
  return entries.filter((e) => {
    const promptName = e.prompt.name.toLowerCase();
    const serverId = e.serverId.toLowerCase();
    const desc = (e.prompt.description ?? '').toLowerCase();
    return promptName.includes(q) || serverId.includes(q) || desc.includes(q);
  });
}

export function groupByServer(
  entries: ReadonlyArray<McpPromptEntry>,
): Array<{ serverId: string; serverDisplayName: string; prompts: McpPromptEntry[] }> {
  const map = new Map<
    string,
    { serverId: string; serverDisplayName: string; prompts: McpPromptEntry[] }
  >();
  for (const e of entries) {
    let g = map.get(e.serverId);
    if (!g) {
      g = { serverId: e.serverId, serverDisplayName: e.serverDisplayName, prompts: [] };
      map.set(e.serverId, g);
    }
    g.prompts.push(e);
  }
  return Array.from(map.values());
}

export function formatPromptInsert(entry: McpPromptEntry): string {
  const name = `/${entry.serverId}:${entry.prompt.name}`;
  const args = entry.prompt.arguments ?? [];
  if (args.length === 0) return name + ' ';
  const placeholders = args
    .map((a) => `${a.name}=<${a.required === false ? a.name + '?' : a.name}>`)
    .join(' ');
  return `${name} ${placeholders}`;
}

export function filterSkills(skills: ReadonlyArray<Skill>, query: string): Skill[] {
  if (skills.length === 0) return [];
  const q = query.trim().toLowerCase();
  const enabled = skills.filter((s) => !s.disabled);
  if (q === '') return enabled;
  return enabled.filter((s) => {
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    return name.includes(q) || desc.includes(q) || `skill:${name}`.includes(q);
  });
}

export function formatSkillInsert(skill: Skill): string {
  const head = `/skill:${skill.name}`;
  const args = skill.frontmatter.arguments ?? [];
  if (args.length === 0) return head + ' ';
  const placeholders = args
    .map((a) => `${a.name}=<${a.required === false ? a.name + '?' : a.name}>`)
    .join(' ');
  return `${head} ${placeholders}`;
}

export function filterPluginCommands(
  commands: ReadonlyArray<PluginSlashCommandDescriptor>,
  query: string,
): PluginSlashCommandDescriptor[] {
  if (commands.length === 0) return [];
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  return commands.filter((c) => {
    const name = c.name.toLowerCase();
    const pluginName = c.pluginName.toLowerCase();
    const desc = (c.description ?? '').toLowerCase();
    return name.includes(q) || pluginName.includes(q) || desc.includes(q);
  });
}

export function groupByPlugin(
  commands: ReadonlyArray<PluginSlashCommandDescriptor>,
): Array<{ pluginId: string; pluginName: string; commands: PluginSlashCommandDescriptor[] }> {
  const map = new Map<
    string,
    { pluginId: string; pluginName: string; commands: PluginSlashCommandDescriptor[] }
  >();
  for (const c of commands) {
    let g = map.get(c.pluginId);
    if (!g) {
      g = { pluginId: c.pluginId, pluginName: c.pluginName, commands: [] };
      map.set(c.pluginId, g);
    }
    g.commands.push(c);
  }
  return Array.from(map.values());
}

export function formatPluginCommandInsert(command: PluginSlashCommandDescriptor): string {
  return `/${command.name} `;
}

export interface PluginCommandInvocation {
  command: PluginSlashCommandDescriptor;
  args: string;
}

/**
 * Recognize a composer submission that invokes a plugin slash command:
 * a single-line `/name [args...]` where `name` matches a registered plugin
 * command. The renderer-side mirror of main's `detectSkillInvocation` for
 * `/skill:` messages — selection inserts the command text, dispatch happens
 * at send time so typed args reach the handler. Multi-line messages are never
 * intercepted so prose that happens to start with a matching token still
 * reaches the model intact.
 */
export function detectPluginCommandInvocation(
  text: string,
  commands: ReadonlyArray<PluginSlashCommandDescriptor>,
): PluginCommandInvocation | null {
  if (commands.length === 0) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.includes('\n')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  if (name.length === 0) return null;
  const command = commands.find((c) => c.name === name);
  if (!command) return null;
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  return { command, args };
}

/**
 * Build the grouped entry list shown in the dropdown. Skills land in a single
 * "Skills" group; MCP prompts get one group per server; plugin slash commands
 * get one group per plugin. Returns groups in the order: Skills (if any), then
 * MCP groups, then Plugin groups, each in their original order.
 */
export function buildSlashGroups(
  prompts: ReadonlyArray<McpPromptEntry>,
  skills: ReadonlyArray<Skill>,
  query: string,
  pluginCommands: ReadonlyArray<PluginSlashCommandDescriptor> = [],
): SlashGroup[] {
  const groups: SlashGroup[] = [];
  const skillMatches = filterSkills(skills, query);
  if (skillMatches.length > 0) {
    groups.push({
      header: 'Skills',
      entries: skillMatches.map((skill) => ({ kind: 'skill', skill })),
    });
  }
  const promptMatches = filterPrompts(prompts, query);
  const promptGroups = groupByServer(promptMatches);
  for (const g of promptGroups) {
    groups.push({
      header: `MCP — ${g.serverDisplayName}`,
      entries: g.prompts.map((entry) => ({ kind: 'mcp', entry })),
    });
  }
  const pluginMatches = filterPluginCommands(pluginCommands, query);
  const pluginGroups = groupByPlugin(pluginMatches);
  for (const g of pluginGroups) {
    groups.push({
      header: `Plugin — ${g.pluginName}`,
      entries: g.commands.map((command) => ({ kind: 'plugin', command })),
    });
  }
  return groups;
}

/**
 * Find skills whose `triggers[]` contains a substring of `text`. Case-insensitive.
 * Returns the matching skills in the order they appear in `skills`.
 */
export function findSkillsForTriggerText(skills: ReadonlyArray<Skill>, text: string): Skill[] {
  if (text.length === 0) return [];
  const lower = text.toLowerCase();
  const out: Skill[] = [];
  for (const skill of skills) {
    if (skill.disabled) continue;
    const triggers = skill.frontmatter.triggers ?? [];
    for (const trig of triggers) {
      if (lower.includes(trig.toLowerCase())) {
        out.push(skill);
        break;
      }
    }
  }
  return out;
}

export interface ApplyInsertResult {
  value: string;
  caret: number;
}

export function applyInsert(
  value: string,
  trigger: SlashCommandTrigger,
  caret: number,
  insert: string,
): ApplyInsertResult {
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret);
  const next = before + insert + after;
  return { value: next, caret: before.length + insert.length };
}
