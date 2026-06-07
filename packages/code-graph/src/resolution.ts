import type { CodeGraph } from './graph';
import { normalizeLabel } from './ids';
import type { GraphEdge } from './schema';
import type { ExtractionResult, RawCall, RawImport, RawSymbol } from './extract';

const IMPORT_GUIDED_SCORE = 0.9;
const LABEL_INDEX_SCORE = 0.5;

export type ResolveCallsInput = Pick<ExtractionResult, 'symbols' | 'calls' | 'imports'>;

/**
 * Strip directory and extension to the bare module name, so an import's
 * `moduleStem` can be matched against the file a symbol was defined in.
 *
 * WHY: imports are recorded against the module path the caller wrote, while the
 * graph keys symbols by their defining file — both must collapse to the same
 * stem for an import to point at a real definition.
 */
function moduleStemOf(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = base.lastIndexOf('.');
  const withoutExt = dot > 0 ? base.slice(0, dot) : base;
  return normalizeLabel(withoutExt);
}

function importKey(stem: string, name: string): string {
  return `${moduleStemOf(stem)}\0${normalizeLabel(name)}`;
}

/**
 * Add resolved `calls` edges to `graph` from extracted call sites. Two passes:
 * import-guided (high confidence, EXTRACTED) wins; otherwise a global unique
 * label match is recorded as INFERRED. Member calls and any ambiguous match are
 * skipped — unresolved call sites are expected, never an error.
 */
export function resolveCalls(graph: CodeGraph, input: ResolveCallsInput): void {
  const { symbols, calls, imports } = input;

  const symbolById = new Map<string, RawSymbol>();
  for (const symbol of symbols) symbolById.set(symbol.id, symbol);

  // (defining-module-stem, normalized-label) -> symbol ids defined there.
  const byModuleSymbol = new Map<string, string[]>();
  for (const symbol of symbols) {
    if (!graph.hasNode(symbol.id)) continue;
    const key = importKey(symbol.sourceFile, symbol.label);
    const bucket = byModuleSymbol.get(key);
    if (bucket) bucket.push(symbol.id);
    else byModuleSymbol.set(key, [symbol.id]);
  }

  // normalized-label -> graph symbol ids (global, cross-file).
  const byLabel = new Map<string, string[]>();
  for (const symbol of symbols) {
    if (!graph.hasNode(symbol.id)) continue;
    const key = normalizeLabel(symbol.label);
    const bucket = byLabel.get(key);
    if (bucket) bucket.push(symbol.id);
    else byLabel.set(key, [symbol.id]);
  }

  // (sourceFile, normalized imported name) -> moduleStem it was imported from.
  // The imported name is the local binding: its alias when aliased, else the
  // original symbol name.
  const importsByFile = new Map<string, Map<string, RawImport>>();
  for (const imp of imports) {
    let perFile = importsByFile.get(imp.sourceFile);
    if (!perFile) {
      perFile = new Map<string, RawImport>();
      importsByFile.set(imp.sourceFile, perFile);
    }
    perFile.set(normalizeLabel(imp.alias ?? imp.symbol), imp);
  }

  for (const call of calls) {
    if (call.isMemberCall) continue;
    if (!graph.hasNode(call.callerId)) continue;

    const calleeNorm = normalizeLabel(call.calleeLabel);

    if (tryImportGuided(graph, call, calleeNorm, importsByFile, byModuleSymbol, symbolById)) {
      continue;
    }

    tryLabelIndex(graph, call, calleeNorm, byLabel);
  }
}

function tryImportGuided(
  graph: CodeGraph,
  call: RawCall,
  calleeNorm: string,
  importsByFile: ReadonlyMap<string, ReadonlyMap<string, RawImport>>,
  byModuleSymbol: ReadonlyMap<string, string[]>,
  symbolById: ReadonlyMap<string, RawSymbol>,
): boolean {
  const imp = importsByFile.get(call.sourceFile)?.get(calleeNorm);
  if (imp === undefined) return false;

  const targets = byModuleSymbol.get(importKey(imp.moduleStem, imp.symbol));
  if (targets === undefined || targets.length !== 1) return false;

  const targetId = targets[0] as string;
  const caller = symbolById.get(call.callerId);
  const edge: GraphEdge = {
    source: call.callerId,
    target: targetId,
    relation: 'calls',
    confidence: 'EXTRACTED',
    confidence_score: IMPORT_GUIDED_SCORE,
    source_file: caller?.sourceFile ?? call.sourceFile,
    source_location: { startLine: call.location.startLine, endLine: call.location.endLine },
    weight: 1,
  };
  return graph.addEdge(edge);
}

function tryLabelIndex(
  graph: CodeGraph,
  call: RawCall,
  calleeNorm: string,
  byLabel: ReadonlyMap<string, string[]>,
): boolean {
  const candidates = byLabel.get(calleeNorm);
  if (candidates === undefined || candidates.length !== 1) return false;

  const targetId = candidates[0] as string;
  if (targetId === call.callerId) return false;

  const edge: GraphEdge = {
    source: call.callerId,
    target: targetId,
    relation: 'calls',
    confidence: 'INFERRED',
    confidence_score: LABEL_INDEX_SCORE,
    source_file: call.sourceFile,
    source_location: { startLine: call.location.startLine, endLine: call.location.endLine },
    weight: 1,
  };
  return graph.addEdge(edge);
}
