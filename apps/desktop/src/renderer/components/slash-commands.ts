import type { McpPromptEntry } from '../../shared/mcp';

export interface SlashCommandTrigger {
  query: string;
  start: number;
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
