import { z } from 'zod';
import { defineTool } from '@opencodex/core';

export interface CodeGraphNodeView {
  id: string;
  label: string;
  file: string;
  kind?: string;
  language?: string;
  community?: number | null;
  startLine?: number;
  endLine?: number;
}

export interface CodeGraphEdgeView {
  source: string;
  target: string;
  relation: string;
  confidence: string;
}

export interface CodeGraphQuery {
  workspaceRoot: string;
  op: 'neighbors' | 'callers' | 'callees' | 'path' | 'subsystem';
  target: string;
  target2?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CodeGraphQueryResult {
  nodes: CodeGraphNodeView[];
  edges: CodeGraphEdgeView[];
  note?: string;
}

export interface CodeGraphResolver {
  query(q: CodeGraphQuery): Promise<CodeGraphQueryResult>;
}

let activeResolver: CodeGraphResolver | null = null;

export function setCodeGraphResolver(resolver: CodeGraphResolver | null): void {
  activeResolver = resolver;
}

export function getCodeGraphResolver(): CodeGraphResolver | null {
  return activeResolver;
}

const inputSchema = z
  .object({
    op: z.enum(['neighbors', 'callers', 'callees', 'path', 'subsystem']),
    target: z.string().min(1),
    target2: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export const queryCodeGraphTool = defineTool({
  name: 'query_code_graph',
  description:
    'Query the code knowledge graph for relationships between symbols. "op" selects the relationship: "neighbors" returns symbols directly connected to "target"; "callers" returns symbols that call "target"; "callees" returns symbols that "target" calls; "path" finds the shortest relationship chain between "target" and "target2" (required for this op); "subsystem" returns the community/cluster that "target" belongs to. "target" is the symbol name to start from; "target2" is the destination symbol, used only by "path". "limit" caps the number of returned nodes (1-200, default chosen by the resolver). Returns { nodes, edges }; if the graph is unavailable, returns an empty result with a "note".',
  inputZod: inputSchema,
  permissionTier: 'read',
  async execute(input, ctx) {
    const r = getCodeGraphResolver();
    if (!r) {
      return {
        nodes: [],
        edges: [],
        note: 'Code graph is not available for this workspace yet.',
      } satisfies CodeGraphQueryResult;
    }
    return r.query({
      workspaceRoot: ctx.workspaceRoot,
      op: input.op,
      target: input.target,
      target2: input.target2,
      limit: input.limit,
      signal: ctx.signal,
    });
  },
});
