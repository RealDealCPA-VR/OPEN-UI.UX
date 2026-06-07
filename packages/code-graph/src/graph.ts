import { DirectedGraph } from 'graphology';
import { normalizeLabel } from './ids';
import { graphEdgeSchema, graphNodeSchema, type GraphEdge, type GraphNode } from './schema';

type NodeAttributes = Omit<GraphNode, 'id'>;
type EdgeAttributes = Omit<GraphEdge, 'source' | 'target'>;

const EXTENSION_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ['ts', 'ts'],
  ['tsx', 'ts'],
  ['mts', 'ts'],
  ['cts', 'ts'],
  ['js', 'ts'],
  ['jsx', 'ts'],
  ['mjs', 'ts'],
  ['cjs', 'ts'],
  ['py', 'python'],
  ['pyi', 'python'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['java', 'jvm'],
  ['kt', 'jvm'],
  ['kts', 'jvm'],
  ['scala', 'jvm'],
  ['c', 'c'],
  ['h', 'c'],
  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cxx', 'cpp'],
  ['hpp', 'cpp'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['cs', 'dotnet'],
  ['swift', 'swift'],
]);

// Aliases that should resolve to the same language family.
const LANGUAGE_FAMILY: ReadonlyMap<string, string> = new Map([
  ['typescript', 'ts'],
  ['javascript', 'ts'],
  ['ts', 'ts'],
  ['tsx', 'ts'],
  ['js', 'ts'],
  ['jsx', 'ts'],
  ['python', 'python'],
  ['py', 'python'],
  ['golang', 'go'],
  ['go', 'go'],
  ['rust', 'rust'],
  ['rs', 'rust'],
  ['java', 'jvm'],
  ['kotlin', 'jvm'],
  ['scala', 'jvm'],
  ['csharp', 'dotnet'],
  ['c#', 'dotnet'],
  ['cpp', 'cpp'],
  ['c++', 'cpp'],
  ['c', 'c'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['swift', 'swift'],
]);

function familyFromExtension(sourceFile: string): string | undefined {
  const dot = sourceFile.lastIndexOf('.');
  if (dot < 0 || dot === sourceFile.length - 1) return undefined;
  return EXTENSION_LANGUAGE.get(sourceFile.slice(dot + 1).toLowerCase());
}

export function languageFamilyOf(node: GraphNode): string | undefined {
  const declared = node.metadata?.['language'];
  if (typeof declared === 'string') {
    const fam = LANGUAGE_FAMILY.get(declared.toLowerCase());
    if (fam) return fam;
  }
  return familyFromExtension(node.source_file);
}

export type CodeGraphJson = { nodes: GraphNode[]; edges: GraphEdge[] };

export class CodeGraph {
  private readonly graph: DirectedGraph<NodeAttributes, EdgeAttributes>;

  // normalizedLabel -> canonical node id, used to resolve edge endpoints that
  // were emitted against a label rather than a concrete id.
  private readonly normToCanonical = new Map<string, string>();

  constructor() {
    this.graph = new DirectedGraph<NodeAttributes, EdgeAttributes>();
  }

  get order(): number {
    return this.graph.order;
  }

  get size(): number {
    return this.graph.size;
  }

  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  /** Idempotent insert. Re-adding an id overwrites attributes (last write wins). */
  addNode(node: GraphNode): void {
    const { id, ...attrs } = node;
    if (this.graph.hasNode(id)) {
      this.graph.replaceNodeAttributes(id, attrs);
    } else {
      this.graph.addNode(id, attrs);
    }
    this.normToCanonical.set(normalizeLabel(node.label), id);
    this.normToCanonical.set(normalizeLabel(id), id);
  }

  getNode(id: string): GraphNode | undefined {
    if (!this.graph.hasNode(id)) return undefined;
    return { id, ...this.graph.getNodeAttributes(id) };
  }

  private resolveEndpoint(ref: string): string | undefined {
    if (this.graph.hasNode(ref)) return ref;
    return this.normToCanonical.get(normalizeLabel(ref));
  }

  /**
   * Insert an edge after resolving both endpoints to canonical node ids.
   * Returns false (silently) when the edge is dropped — dangling endpoints to
   * external/stdlib symbols are expected, not errors.
   */
  addEdge(edge: GraphEdge): boolean {
    const source = this.resolveEndpoint(edge.source);
    const target = this.resolveEndpoint(edge.target);
    if (source === undefined || target === undefined) return false;

    if (this.isCrossLanguageInferredCall(edge, source, target)) return false;

    const { source: _s, target: _t, ...attrs } = edge;
    this.graph.mergeDirectedEdge(source, target, attrs);
    return true;
  }

  private isCrossLanguageInferredCall(edge: GraphEdge, source: string, target: string): boolean {
    if (edge.relation !== 'calls' || edge.confidence !== 'INFERRED') return false;
    const srcFam = languageFamilyOf({ id: source, ...this.graph.getNodeAttributes(source) });
    const tgtFam = languageFamilyOf({ id: target, ...this.graph.getNodeAttributes(target) });
    if (srcFam === undefined || tgtFam === undefined) return false;
    return srcFam !== tgtFam;
  }

  neighbors(id: string): string[] {
    if (!this.graph.hasNode(id)) return [];
    return this.graph.neighbors(id);
  }

  /** Nodes that have a directed edge pointing at `id` (its in-neighbors). */
  callersOf(id: string): string[] {
    if (!this.graph.hasNode(id)) return [];
    return this.graph.inNeighbors(id);
  }

  /** BFS shortest directed path from `a` to `b`, inclusive; null if none. */
  pathBetween(a: string, b: string): string[] | null {
    if (!this.graph.hasNode(a) || !this.graph.hasNode(b)) return null;
    if (a === b) return [a];

    const previous = new Map<string, string>();
    const visited = new Set<string>([a]);
    let frontier = [a];

    while (frontier.length > 0) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbor of this.graph.outNeighbors(node)) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          previous.set(neighbor, node);
          if (neighbor === b) return reconstruct(previous, a, b);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return null;
  }

  forEachNode(callback: (node: GraphNode) => void): void {
    this.graph.forEachNode((id, attrs) => callback({ id, ...attrs }));
  }

  forEachEdge(callback: (edge: GraphEdge) => void): void {
    this.graph.forEachEdge((_edge, attrs, source, target) => {
      callback({ source, target, ...attrs });
    });
  }

  /** Direct access to the backing graphology instance (dedup/communities use it). */
  raw(): DirectedGraph<NodeAttributes, EdgeAttributes> {
    return this.graph;
  }

  toJson(): CodeGraphJson {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    this.forEachNode((n) => nodes.push(n));
    this.forEachEdge((e) => edges.push(e));
    return { nodes, edges };
  }

  static buildFromJson(input: { nodes: unknown; edges: unknown }): CodeGraph {
    const nodes = graphNodeSchema.array().parse(input.nodes);
    const edges = graphEdgeSchema.array().parse(input.edges);

    const graph = new CodeGraph();
    for (const node of nodes) graph.addNode(node);
    for (const edge of edges) graph.addEdge(edge);
    return graph;
  }
}

function reconstruct(previous: Map<string, string>, start: string, end: string): string[] {
  const path = [end];
  let cursor = end;
  while (cursor !== start) {
    const prev = previous.get(cursor);
    if (prev === undefined) return [];
    path.push(prev);
    cursor = prev;
  }
  return path.reverse();
}
