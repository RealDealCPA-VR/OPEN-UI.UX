import type Database from 'better-sqlite3';
import {
  buildGraphFromExtraction,
  dedupe,
  detectCommunities,
  type CodeGraph,
  type ExtractionResult,
} from '@opencodex/code-graph';
import { extractSymbols } from '@opencodex/rag-chunker';
import { logger } from '../logger';
import { languageForPath } from './ast-chunk';
import { persistWorkspaceGraph } from './code-graph-store';

export interface BuiltGraph {
  graph: CodeGraph;
  communities: Map<string, number>;
}

/**
 * Merge every extraction into a single graph, dedup similar symbols, then
 * partition into communities. The merge is a flat concat: ids are already
 * file-scoped (`${file}::${symbolPath}`), so cross-file collisions can't occur.
 */
export function buildGraphFromExtractions(extractions: readonly ExtractionResult[]): BuiltGraph {
  const merged: ExtractionResult = { symbols: [], calls: [], imports: [] };
  for (const e of extractions) {
    merged.symbols.push(...e.symbols);
    merged.calls.push(...e.calls);
    merged.imports.push(...e.imports);
  }

  const raw = buildGraphFromExtraction(merged);
  const graph = dedupe(raw);
  const communities = detectCommunities(graph);
  return { graph, communities };
}

export interface WorkspaceFileInput {
  /** Path used as the symbol id prefix and source_file. Workspace-relative. */
  file: string;
  content: string;
  /** Explicit language; when omitted it is inferred from the file extension. */
  language?: string;
}

/**
 * Extract symbols for each input file (skipping files with no detectable
 * language), build + persist the workspace graph. Per-file extraction is wrapped
 * in try/catch so one unparseable file can't abort the whole rebuild.
 */
export async function rebuildWorkspaceGraph(
  db: Database.Database,
  workspaceId: string,
  files: readonly WorkspaceFileInput[],
): Promise<BuiltGraph> {
  const extractions: ExtractionResult[] = [];
  for (const input of files) {
    const language = input.language ?? languageForPath(input.file) ?? undefined;
    if (!language) continue;
    try {
      const result = await extractSymbols({
        code: input.content,
        language,
        filePath: input.file,
      });
      extractions.push(result);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), workspaceId, file: input.file },
        'code-graph: symbol extraction failed for file; skipping',
      );
    }
  }

  const built = buildGraphFromExtractions(extractions);
  persistWorkspaceGraph(db, workspaceId, built.graph, built.communities);
  return built;
}
