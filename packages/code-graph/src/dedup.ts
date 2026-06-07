import { CodeGraph } from './graph';
import { normalizeLabel } from './ids';
import { jaroWinkler } from './jaro-winkler';
import type { GraphNode } from './schema';

export const DEFAULT_DEDUP_THRESHOLD = 0.92;

const CHUNK_SUFFIX = /::chunk\d+$/i;

function isChunkSuffixed(id: string): boolean {
  return CHUNK_SUFFIX.test(id);
}

/**
 * Pick the canonical id for a merge cluster: prefer non-chunk-suffixed ids,
 * then shorter, then lexicographic — fully deterministic.
 */
function chooseCanonical(ids: ReadonlyArray<string>): string {
  return [...ids].sort((a, b) => {
    const aChunk = isChunkSuffixed(a);
    const bChunk = isChunkSuffixed(b);
    if (aChunk !== bChunk) return aChunk ? 1 : -1;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0] as string;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    let cursor = id;
    while (cursor !== root) {
      const next = this.parent.get(cursor) as string;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Merge nodes whose normalized labels are equal, or whose Jaro-Winkler
 * similarity is at or above `threshold`. Edge endpoints are rewritten to the
 * canonical id and self-loops produced by the merge are dropped.
 *
 * WHY: the 0.75–0.92 ambiguous band is intentionally deferred — resolving it
 * needs an LLM tie-break that is gated behind a setting and out of scope here.
 */
export function dedupe(graph: CodeGraph, threshold: number = DEFAULT_DEDUP_THRESHOLD): CodeGraph {
  const nodes: GraphNode[] = [];
  graph.forEachNode((n) => nodes.push(n));
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const uf = new UnionFind();
  for (const node of nodes) uf.add(node.id);

  const byNorm = new Map<string, string[]>();
  for (const node of nodes) {
    const key = normalizeLabel(node.label);
    const bucket = byNorm.get(key);
    if (bucket) bucket.push(node.id);
    else byNorm.set(key, [node.id]);
  }
  for (const bucket of byNorm.values()) {
    for (let i = 1; i < bucket.length; i++) {
      uf.union(bucket[0] as string, bucket[i] as string);
    }
  }

  const norms = nodes.map((n) => normalizeLabel(n.label));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (jaroWinkler(norms[i] as string, norms[j] as string) >= threshold) {
        uf.union((nodes[i] as GraphNode).id, (nodes[j] as GraphNode).id);
      }
    }
  }

  const clusters = new Map<string, string[]>();
  for (const node of nodes) {
    const root = uf.find(node.id);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(node.id);
    else clusters.set(root, [node.id]);
  }

  const canonicalOf = new Map<string, string>();
  const attrsByCanonical = new Map<string, GraphNode>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const cluster of clusters.values()) {
    const canonical = chooseCanonical(cluster);
    for (const id of cluster) canonicalOf.set(id, canonical);
    attrsByCanonical.set(canonical, nodeById.get(canonical) as GraphNode);
  }

  const result = new CodeGraph();
  for (const [canonical, node] of attrsByCanonical) {
    result.addNode({ ...node, id: canonical });
  }

  graph.forEachEdge((edge) => {
    const source = canonicalOf.get(edge.source) ?? edge.source;
    const target = canonicalOf.get(edge.target) ?? edge.target;
    if (source === target) return;
    result.addEdge({ ...edge, source, target });
  });

  return result;
}
