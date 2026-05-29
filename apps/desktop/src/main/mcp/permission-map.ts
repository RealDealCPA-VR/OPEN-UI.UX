import type { McpPermissionCategory, McpPermissionCategoryId } from '../../shared/mcp-registry';

interface CategoryDef {
  id: McpPermissionCategoryId;
  label: string;
  humanReadable: string;
  severity: 'low' | 'medium' | 'high';
  toolPatterns: RegExp[];
  serverIdPatterns?: RegExp[];
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    id: 'fs-read',
    label: 'Read files',
    humanReadable: 'can read files on your filesystem',
    severity: 'medium',
    toolPatterns: [/^read[_-]?file$/i, /^list[_-]?(dir|directory|files)$/i, /^stat$/i, /^glob$/i],
  },
  {
    id: 'fs-write',
    label: 'Write files',
    humanReadable: 'can create, edit, and delete files on your filesystem',
    severity: 'high',
    toolPatterns: [
      /^write[_-]?file$/i,
      /^edit[_-]?file$/i,
      /^delete[_-]?file$/i,
      /^move[_-]?file$/i,
      /^create[_-]?directory$/i,
    ],
  },
  {
    id: 'network',
    label: 'Network',
    humanReadable: 'can make outbound network requests on your behalf',
    severity: 'high',
    toolPatterns: [/^fetch$/i, /^http[_-]?request$/i, /^web[_-]?(search|fetch)$/i],
  },
  {
    id: 'git',
    label: 'Git',
    humanReadable: 'can read and modify your git repository',
    severity: 'medium',
    toolPatterns: [/^git[_-].*/i, /^commit$/i, /^branch$/i, /^merge$/i, /^rebase$/i],
  },
  {
    id: 'shell',
    label: 'Shell',
    humanReadable: 'can run shell commands on your machine',
    severity: 'high',
    toolPatterns: [/^(run|exec|spawn|shell)[_-]?(command|process)?$/i, /^bash$/i],
  },
  {
    id: 'database',
    label: 'Database',
    humanReadable: 'can read and modify a local database',
    severity: 'medium',
    toolPatterns: [/^(query|sql|select|insert|update|delete)$/i, /^db[_-].*/i],
    serverIdPatterns: [/sqlite/i, /postgres/i, /mysql/i, /mongo/i],
  },
  {
    id: 'search',
    label: 'Search',
    humanReadable: 'can perform web or content searches',
    severity: 'low',
    toolPatterns: [/^search$/i, /^find$/i, /^query$/i],
    serverIdPatterns: [/search/i, /brave/i, /perplexity/i],
  },
  {
    id: 'github',
    label: 'GitHub',
    humanReadable: 'can call GitHub on your behalf (issues, PRs, code search)',
    severity: 'medium',
    toolPatterns: [/^(github|gh)[_-].*/i, /^(create|update|close)[_-]?(issue|pr|pull)$/i],
    serverIdPatterns: [/^github$/i],
  },
  {
    id: 'browser',
    label: 'Browser',
    humanReadable: 'can drive a browser (navigate, click, type)',
    severity: 'high',
    toolPatterns: [/^(navigate|click|type|screenshot)$/i, /^browser[_-].*/i, /^puppeteer.*/i],
  },
  {
    id: 'memory',
    label: 'Memory',
    humanReadable: 'can read and write persistent notes/memory',
    severity: 'medium',
    toolPatterns: [/^(remember|recall|note|memory)[_-]?.*/i],
  },
];

const CATEGORY_BY_ID: Record<McpPermissionCategoryId, McpPermissionCategory> = (() => {
  const out: Partial<Record<McpPermissionCategoryId, McpPermissionCategory>> = {};
  for (const def of CATEGORY_DEFS) {
    out[def.id] = {
      id: def.id,
      label: def.label,
      humanReadable: def.humanReadable,
      severity: def.severity,
    };
  }
  out['unknown'] = {
    id: 'unknown',
    label: 'Other tools',
    humanReadable: 'exposes tools whose effects we could not classify',
    severity: 'low',
  };
  return out as Record<McpPermissionCategoryId, McpPermissionCategory>;
})();

export function classifyToolName(toolName: string, serverId?: string): McpPermissionCategoryId {
  for (const def of CATEGORY_DEFS) {
    if (def.toolPatterns.some((p) => p.test(toolName))) return def.id;
    if (serverId && def.serverIdPatterns?.some((p) => p.test(serverId))) {
      if (def.toolPatterns.length === 0) return def.id;
    }
  }
  if (serverId) {
    for (const def of CATEGORY_DEFS) {
      if (def.serverIdPatterns?.some((p) => p.test(serverId))) return def.id;
    }
  }
  return 'unknown';
}

export function categoriesForServer(
  serverId: string,
  toolNames: readonly string[],
): McpPermissionCategory[] {
  const seen = new Set<McpPermissionCategoryId>();
  for (const tn of toolNames) {
    const id = classifyToolName(tn, serverId);
    seen.add(id);
  }
  if (toolNames.length === 0) {
    const fallback = classifyToolName('', serverId);
    seen.add(fallback);
  }
  return Array.from(seen).map((id) => CATEGORY_BY_ID[id]);
}

export function getCategoryById(id: McpPermissionCategoryId): McpPermissionCategory {
  return CATEGORY_BY_ID[id];
}
