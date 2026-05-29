import { z } from 'zod';
import { defineTool, type ToolContext } from '@opencodex/core';
import { grepTool, type GrepMatch } from './grep';

const inputSchema = z.object({
  query: z.string().min(1).describe('The pattern to search for (regex or literal)'),
  literal: z.boolean().optional().default(false).describe('Treat query as a literal string'),
  glob: z.string().optional().describe('Glob filter, e.g. "**/*.ts"'),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
  workspaceIds: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional list of workspace ids to search across. When omitted, the active (primary) workspace is searched.',
    ),
});

export type SearchHitSource = 'workspace' | 'mcp';

export type SearchHit = {
  file: string;
  line: number;
  preview: string;
  score: number;
  source: SearchHitSource;
  workspaceId?: string;
  related?: RelatedWorkspaceRef[];
};

export interface RelatedWorkspaceRef {
  workspaceId: string;
  importPath: string;
}

export const MCP_INDEX_PREFIX = 'mcp:';

export function sourceOfPath(filePath: string): SearchHitSource {
  return filePath.startsWith(MCP_INDEX_PREFIX) ? 'mcp' : 'workspace';
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface WorkspaceForSearch {
  id: string;
  workspaceRoot: string;
}

export interface SearchWorkspaceResolver {
  /** Returns the workspace metadata for the given id, or null when unknown / RAG-disabled. */
  resolve(id: string): WorkspaceForSearch | null;
  /** Returns every workspace that should be considered for cross-workspace dependency follow-up. */
  listEnabled(): WorkspaceForSearch[];
}

let activeResolver: SearchWorkspaceResolver | null = null;

export function setSearchWorkspaceResolver(resolver: SearchWorkspaceResolver | null): void {
  activeResolver = resolver;
}

export function getSearchWorkspaceResolver(): SearchWorkspaceResolver | null {
  return activeResolver;
}

export const searchCodebaseTool = defineTool({
  name: 'search_codebase',
  description:
    'Search the active workspace (and any indexed MCP resources) for occurrences of a pattern. Returns ranked file:line hits with previews. Each hit has a "source" field ("workspace" for files under the workspace root, "mcp" for MCP resources whose key is prefixed with "mcp:"). Pass workspaceIds to fan out across multiple registered workspaces; each hit is then tagged with its source workspaceId and a "related" array surfaces cross-workspace import targets.',
  inputZod: inputSchema,
  permissionTier: 'read',
  async execute(input, ctx) {
    const pattern = input.literal ? escapeRegex(input.query) : input.query;
    const baseGrepInput = {
      pattern,
      ...(input.glob ? { glob: input.glob } : {}),
      maxMatches: input.maxResults,
    };

    const resolver = activeResolver;
    const requestedIds = input.workspaceIds ?? [];

    let perWorkspaceRanked: SearchHit[][] = [];

    if (requestedIds.length === 0 || resolver === null) {
      const result = (await grepTool.execute(baseGrepInput as never, ctx)) as GrepMatch[];
      perWorkspaceRanked = [rank(result, input.query, undefined)];
    } else {
      for (const id of requestedIds) {
        const ws = resolver.resolve(id);
        if (!ws) continue;
        const subCtx: ToolContext = { ...ctx, workspaceRoot: ws.workspaceRoot };
        let result: GrepMatch[];
        try {
          result = (await grepTool.execute(baseGrepInput as never, subCtx)) as GrepMatch[];
        } catch (err) {
          ctx.logger?.error?.('search_codebase: per-workspace grep failed', {
            err: err instanceof Error ? err.message : String(err),
            workspaceId: id,
          });
          continue;
        }
        perWorkspaceRanked.push(rank(result, input.query, id));
      }
    }

    const fused =
      perWorkspaceRanked.length > 1
        ? fuseRankedHits(perWorkspaceRanked)
        : (perWorkspaceRanked[0] ?? []);

    const candidates = fused.slice(0, input.maxResults);

    if (resolver !== null) {
      const enabled = resolver.listEnabled();
      if (enabled.length > 1) {
        // Best-effort: only top-K to keep cost bounded. Sample size matches what the
        // agent renderer typically surfaces; we bail early when none match.
        const top = candidates.slice(0, Math.min(candidates.length, 25));
        for (const hit of top) {
          const sourceWsId = hit.workspaceId;
          const related = detectCrossWorkspaceRelated({
            hitText: hit.preview,
            sourceWorkspaceId: sourceWsId,
            workspaces: enabled,
          });
          if (related.length > 0) hit.related = related;
        }
      }
    }

    return {
      query: input.query,
      hitCount: candidates.length,
      hits: candidates,
    };
  },
});

function fuseRankedHits(rankings: SearchHit[][]): SearchHit[] {
  return reciprocalRankFusion(
    rankings,
    (hit) => `${hit.workspaceId ?? '_'}:${hit.file}:${hit.line}`,
  );
}

function rank(hits: readonly GrepMatch[], query: string, workspaceId?: string): SearchHit[] {
  const lower = query.toLowerCase();
  return hits
    .map((h): SearchHit => {
      const matchLower = h.text.toLowerCase();
      let score = 0;
      if (matchLower.includes(lower)) score += 10;
      if (h.file.toLowerCase().includes(lower)) score += 5;
      if (h.file.endsWith('.md') || h.file.endsWith('.txt')) score -= 1;
      if (h.file.includes('test') || h.file.includes('__fixtures__')) score -= 2;
      const hit: SearchHit = {
        file: h.file,
        line: h.line,
        preview: h.text,
        score,
        source: sourceOfPath(h.file),
      };
      if (workspaceId !== undefined) hit.workspaceId = workspaceId;
      return hit;
    })
    .sort((a, b) => b.score - a.score);
}

export { rank as rankSearchHits };

export function reciprocalRankFusion<T>(
  rankings: ReadonlyArray<ReadonlyArray<T>>,
  keyOf: (item: T) => string,
  k = 60,
): T[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const item = ranking[i];
      if (item === undefined) continue;
      const key = keyOf(item);
      const cur = scores.get(key) ?? { item, score: 0 };
      cur.score += 1 / (k + i + 1);
      scores.set(key, cur);
    }
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

// Patterns: `import ... from 'X'`, `import('X')`, `require('X')`, Rust `use X::...`, Python `from X import`.
const IMPORT_PATTERNS: RegExp[] = [
  /\bimport\s+(?:[^'"`;]+?\s+from\s+)?['"`]([^'"`]+)['"`]/g,
  /\bimport\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  /\brequire\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  /\buse\s+([A-Za-z_][\w:]*)/g,
  /\bfrom\s+([\w./]+)\s+import\b/g,
];

interface CrossWorkspaceArgs {
  hitText: string;
  sourceWorkspaceId: string | undefined;
  workspaces: readonly WorkspaceForSearch[];
}

function detectCrossWorkspaceRelated(args: CrossWorkspaceArgs): RelatedWorkspaceRef[] {
  const candidates = extractImportSpecifiers(args.hitText);
  if (candidates.length === 0) return [];
  const seen = new Set<string>();
  const out: RelatedWorkspaceRef[] = [];
  for (const spec of candidates) {
    for (const ws of args.workspaces) {
      if (args.sourceWorkspaceId !== undefined && ws.id === args.sourceWorkspaceId) continue;
      if (!referencesWorkspace(spec, ws.workspaceRoot)) continue;
      const key = `${ws.id}:${spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ workspaceId: ws.id, importPath: spec });
    }
  }
  return out;
}

export function extractImportSpecifiers(line: string): string[] {
  const out = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const captured = match[1];
      if (captured && captured.length > 0) out.add(captured);
    }
  }
  return Array.from(out);
}

function referencesWorkspace(specifier: string, workspaceRoot: string): boolean {
  // Bare relative imports never cross workspace boundaries.
  if (specifier.startsWith('./') || specifier.startsWith('../')) return false;
  const normalizedSpec = specifier.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase();
  const tail = normalizedRoot.split('/').filter(Boolean).pop();
  if (!tail) return false;
  return normalizedSpec === tail || normalizedSpec.startsWith(`${tail}/`);
}
