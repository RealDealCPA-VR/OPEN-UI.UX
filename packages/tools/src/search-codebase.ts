import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { grepTool, type GrepMatch } from './grep';

const inputSchema = z.object({
  query: z.string().min(1).describe('The pattern to search for (regex or literal)'),
  literal: z.boolean().optional().default(false).describe('Treat query as a literal string'),
  glob: z.string().optional().describe('Glob filter, e.g. "**/*.ts"'),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
});

export type SearchHitSource = 'workspace' | 'mcp';

export type SearchHit = {
  file: string;
  line: number;
  preview: string;
  score: number;
  source: SearchHitSource;
};

export const MCP_INDEX_PREFIX = 'mcp:';

export function sourceOfPath(filePath: string): SearchHitSource {
  return filePath.startsWith(MCP_INDEX_PREFIX) ? 'mcp' : 'workspace';
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const searchCodebaseTool = defineTool({
  name: 'search_codebase',
  description:
    'Search the active workspace (and any indexed MCP resources) for occurrences of a pattern. Returns ranked file:line hits with previews. Each hit has a "source" field ("workspace" for files under the workspace root, "mcp" for MCP resources whose key is prefixed with "mcp:"). Use this before opening files when looking for symbols, references, or examples.',
  inputZod: inputSchema,
  permissionTier: 'read',
  async execute(input, ctx) {
    const pattern = input.literal ? escapeRegex(input.query) : input.query;
    const grepInput = {
      pattern,
      ...(input.glob ? { glob: input.glob } : {}),
      maxMatches: input.maxResults,
    };
    const result = (await grepTool.execute(grepInput as never, ctx)) as GrepMatch[];
    const ranked = rank(result, input.query);
    return {
      query: input.query,
      hitCount: ranked.length,
      hits: ranked.slice(0, input.maxResults),
    };
  },
});

function rank(hits: readonly GrepMatch[], query: string): SearchHit[] {
  const lower = query.toLowerCase();
  return hits
    .map((h) => {
      const matchLower = h.text.toLowerCase();
      let score = 0;
      if (matchLower.includes(lower)) score += 10;
      if (h.file.toLowerCase().includes(lower)) score += 5;
      if (h.file.endsWith('.md') || h.file.endsWith('.txt')) score -= 1;
      if (h.file.includes('test') || h.file.includes('__fixtures__')) score -= 2;
      return {
        file: h.file,
        line: h.line,
        preview: h.text,
        score,
        source: sourceOfPath(h.file),
      };
    })
    .sort((a, b) => b.score - a.score);
}

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
