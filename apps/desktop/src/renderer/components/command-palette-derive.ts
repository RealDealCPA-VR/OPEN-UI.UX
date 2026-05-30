import type { ConversationSearchHit } from '../../shared/conversation-search';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import type { Skill } from '../../shared/skills';

export type PaletteCategory = 'action' | 'message' | 'file' | 'skill' | 'mcp-tool';

export interface PaletteAction {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  perform: () => void;
}

export interface PaletteMcpTool {
  serverId: string;
  serverDisplayName: string;
  toolName: string;
  description?: string;
}

export interface PaletteEntry {
  id: string;
  category: PaletteCategory;
  title: string;
  subtitle: string;
  detail: string | null;
  rank: number;
  message?: ConversationSearchHit;
  file?: CodebaseSearchHit;
  skill?: Skill;
  mcpTool?: PaletteMcpTool;
  action?: PaletteAction;
}

interface MergeOptions {
  perCategoryLimit?: number;
}

const DEFAULT_PER_CATEGORY = 20;

export function mergePaletteResults(
  messageHits: ReadonlyArray<ConversationSearchHit>,
  fileHits: ReadonlyArray<CodebaseSearchHit>,
  skillHits: ReadonlyArray<Skill>,
  query: string,
  options: MergeOptions & {
    mcpTools?: ReadonlyArray<PaletteMcpTool>;
    actions?: ReadonlyArray<PaletteAction>;
  } = {},
): PaletteEntry[] {
  const limit = options.perCategoryLimit ?? DEFAULT_PER_CATEGORY;
  const normalizedQuery = query.trim().toLowerCase();

  const actionEntries: PaletteEntry[] = (options.actions ?? [])
    .filter((a) => matchesAction(a, normalizedQuery))
    .slice(0, limit)
    .map((action, idx) => ({
      id: `action:${action.id}`,
      category: 'action',
      title: action.title,
      subtitle: action.subtitle,
      detail: null,
      rank: idx,
      action,
    }));

  const messageEntries: PaletteEntry[] = messageHits.slice(0, limit).map((hit, idx) => ({
    id: `message:${hit.messageId}`,
    category: 'message',
    title: hit.conversationTitle || 'Untitled conversation',
    subtitle: cleanSnippet(hit.snippet),
    detail: formatTimestamp(hit.createdAt),
    rank: idx,
    message: hit,
  }));

  const fileEntries: PaletteEntry[] = fileHits.slice(0, limit).map((hit, idx) => ({
    id: `file:${hit.path}:${hit.line ?? 0}`,
    category: 'file',
    title: basename(hit.path),
    subtitle: hit.path,
    detail: hit.snippet ? hit.snippet.slice(0, 120) : hit.line ? `line ${hit.line}` : null,
    rank: idx,
    file: hit,
  }));

  const skillEntries: PaletteEntry[] = skillHits
    .filter((s) => matchesSkill(s, normalizedQuery))
    .slice(0, limit)
    .map((skill, idx) => ({
      id: `skill:${skill.id}`,
      category: 'skill',
      title: `/skill:${skill.name}`,
      subtitle: skill.description,
      detail: skill.disabled ? 'disabled' : skill.scope,
      rank: idx,
      skill,
    }));

  const mcpToolEntries: PaletteEntry[] = (options.mcpTools ?? [])
    .filter((t) => matchesMcpTool(t, normalizedQuery))
    .slice(0, limit)
    .map((tool, idx) => ({
      id: `mcp-tool:${tool.serverId}:${tool.toolName}`,
      category: 'mcp-tool',
      title: `Run ${tool.toolName}`,
      subtitle: tool.description ?? `MCP tool on ${tool.serverDisplayName}`,
      detail: tool.serverDisplayName,
      rank: idx,
      mcpTool: tool,
    }));

  return [...actionEntries, ...messageEntries, ...fileEntries, ...skillEntries, ...mcpToolEntries];
}

function matchesAction(action: PaletteAction, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack = `${action.title} ${action.subtitle} ${action.keywords.join(' ')}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function matchesSkill(skill: Skill, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack = `${skill.name} ${skill.description}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function matchesMcpTool(tool: PaletteMcpTool, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack =
    `${tool.toolName} ${tool.serverDisplayName} ${tool.description ?? ''}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function basename(p: string): string {
  const slashIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slashIdx >= 0 ? p.slice(slashIdx + 1) : p;
}

function cleanSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim();
}

function formatTimestamp(iso: string): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function groupByCategory(
  entries: ReadonlyArray<PaletteEntry>,
): Record<PaletteCategory, PaletteEntry[]> {
  return {
    action: entries.filter((e) => e.category === 'action'),
    message: entries.filter((e) => e.category === 'message'),
    file: entries.filter((e) => e.category === 'file'),
    skill: entries.filter((e) => e.category === 'skill'),
    'mcp-tool': entries.filter((e) => e.category === 'mcp-tool'),
  };
}

export function flattenForKeyboardNav(entries: ReadonlyArray<PaletteEntry>): PaletteEntry[] {
  const groups = groupByCategory(entries);
  return [
    ...groups.action,
    ...groups.message,
    ...groups.file,
    ...groups.skill,
    ...groups['mcp-tool'],
  ];
}
