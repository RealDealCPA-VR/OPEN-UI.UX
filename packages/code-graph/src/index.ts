/**
 * @opencodex/code-graph
 *
 * Deterministic code knowledge graph: symbol/edge ingestion with cross-file
 * endpoint reconciliation, similarity-based dedup, and Louvain community
 * detection. Sibling to the RAG retrieval stack.
 */

export { normalizeLabel, makeNodeId } from './ids';
export { jaroWinkler } from './jaro-winkler';

export {
  graphNodeSchema,
  graphEdgeSchema,
  graphJsonSchema,
  sourceLocationSchema,
  fileTypeSchema,
  relationSchema,
  confidenceSchema,
} from './schema';
export type {
  GraphNode,
  GraphEdge,
  GraphJson,
  SourceLocation,
  FileType,
  Relation,
  Confidence,
} from './schema';

export { CodeGraph, languageFamilyOf } from './graph';
export type { CodeGraphJson } from './graph';

export { dedupe, DEFAULT_DEDUP_THRESHOLD } from './dedup';

export { detectCommunities, remapCommunitiesToPrevious } from './communities';
export type { DetectCommunitiesOptions } from './communities';

export {
  buildGraphFromExtraction,
  rawSymbolSchema,
  rawSymbolKindSchema,
  rawCallSchema,
  rawImportSchema,
  extractionResultSchema,
} from './extract';
export type {
  RawSymbol,
  RawSymbolKind,
  RawCall,
  RawImport,
  ExtractionResult,
  BuildGraphFromExtractionOptions,
} from './extract';

export { resolveCalls } from './resolution';
export type { ResolveCallsInput } from './resolution';
