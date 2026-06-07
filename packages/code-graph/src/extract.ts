import { z } from 'zod';
import { CodeGraph } from './graph';
import { resolveCalls } from './resolution';
import type { GraphEdge, GraphNode } from './schema';

export const rawSymbolKindSchema = z.enum([
  'function',
  'class',
  'method',
  'struct',
  'interface',
  'enum',
]);

export const rawSymbolSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    kind: rawSymbolKindSchema,
    sourceFile: z.string(),
    language: z.string(),
    location: z
      .object({
        startLine: z.number().int(),
        endLine: z.number().int(),
      })
      .strict(),
    parentId: z.string().optional(),
  })
  .strict();

export const rawCallSchema = z
  .object({
    callerId: z.string(),
    calleeLabel: z.string(),
    isMemberCall: z.boolean(),
    sourceFile: z.string(),
    location: z
      .object({
        startLine: z.number().int(),
        endLine: z.number().int(),
      })
      .strict(),
  })
  .strict();

export const rawImportSchema = z
  .object({
    moduleStem: z.string(),
    symbol: z.string(),
    alias: z.string().optional(),
    sourceFile: z.string(),
  })
  .strict();

export const extractionResultSchema = z
  .object({
    symbols: z.array(rawSymbolSchema),
    calls: z.array(rawCallSchema),
    imports: z.array(rawImportSchema),
  })
  .strict();

export type RawSymbolKind = z.infer<typeof rawSymbolKindSchema>;
export type RawSymbol = z.infer<typeof rawSymbolSchema>;
export type RawCall = z.infer<typeof rawCallSchema>;
export type RawImport = z.infer<typeof rawImportSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export interface BuildGraphFromExtractionOptions {
  validate?: boolean;
}

/**
 * Turn a language-agnostic extraction into a CodeGraph: one node per symbol,
 * structural containment edges, then resolved call edges.
 *
 * WHY validate by default: extraction output crosses a package boundary (the
 * rag-chunker emits a structurally identical shape it owns separately), so the
 * .strict() parse is the contract checkpoint that keeps the two in lockstep.
 */
export function buildGraphFromExtraction(
  result: ExtractionResult,
  opts: BuildGraphFromExtractionOptions = {},
): CodeGraph {
  const { symbols, calls, imports } =
    opts.validate === false ? result : extractionResultSchema.parse(result);

  const graph = new CodeGraph();

  for (const symbol of symbols) {
    const node: GraphNode = {
      id: symbol.id,
      label: symbol.label,
      file_type: 'code',
      source_file: symbol.sourceFile,
      source_location: { startLine: symbol.location.startLine, endLine: symbol.location.endLine },
      metadata: { language: symbol.language, kind: symbol.kind },
    };
    graph.addNode(node);
  }

  for (const symbol of symbols) {
    if (symbol.parentId === undefined) continue;
    const edge: GraphEdge = {
      source: symbol.parentId,
      target: symbol.id,
      relation: symbol.kind === 'method' ? 'method' : 'contains',
      confidence: 'EXTRACTED',
      confidence_score: 1,
      source_file: symbol.sourceFile,
      source_location: { startLine: symbol.location.startLine, endLine: symbol.location.endLine },
      weight: 1,
    };
    graph.addEdge(edge);
  }

  resolveCalls(graph, { symbols, calls, imports });

  return graph;
}
