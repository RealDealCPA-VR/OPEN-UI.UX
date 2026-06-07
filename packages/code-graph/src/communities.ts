import louvain from 'graphology-communities-louvain';
import { CodeGraph } from './graph';

const LARGE_COMMUNITY_FRACTION = 0.25;
const LARGE_COMMUNITY_MIN_NODES = 10;
const LOW_COHESION_MIN_NODES = 50;
const LOW_COHESION_DENSITY = 0.05;

// Deterministic, seedable PRNG (mulberry32) so Louvain produces identical
// partitions across runs on the same input.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupByCommunity(assignment: Map<string, number>): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const [node, community] of assignment) {
    const members = groups.get(community);
    if (members) members.push(node);
    else groups.set(community, [node]);
  }
  return groups;
}

/**
 * Internal-edge density of a community: directed edges among its members over
 * the maximum possible n*(n-1). Used to detect sprawling, low-cohesion blobs.
 */
function internalDensity(graph: CodeGraph, members: ReadonlyArray<string>): number {
  if (members.length < 2) return 1;
  const set = new Set(members);
  let internal = 0;
  for (const node of members) {
    for (const neighbor of graph.neighbors(node)) {
      if (set.has(neighbor)) internal++;
    }
  }
  // `neighbors` is undirected-merged in graphology; count each pair once.
  const undirectedInternal = internal / 2;
  const maxEdges = (members.length * (members.length - 1)) / 2;
  return maxEdges === 0 ? 1 : undirectedInternal / maxEdges;
}

function subgraphOf(graph: CodeGraph, members: ReadonlyArray<string>): CodeGraph {
  const set = new Set(members);
  const sub = new CodeGraph();
  graph.forEachNode((node) => {
    if (set.has(node.id)) sub.addNode(node);
  });
  graph.forEachEdge((edge) => {
    if (set.has(edge.source) && set.has(edge.target)) sub.addEdge(edge);
  });
  return sub;
}

export type DetectCommunitiesOptions = {
  seed?: number;
  resolution?: number;
};

/**
 * Partition the graph into communities (node id -> community index) via Louvain,
 * then apply cohesion-split heuristics: oversized communities and large
 * low-cohesion communities are re-partitioned in isolation and assigned fresh
 * community ids.
 */
export function detectCommunities(
  graph: CodeGraph,
  options: DetectCommunitiesOptions = {},
): Map<string, number> {
  const result = new Map<string, number>();
  if (graph.order === 0) return result;

  const seed = options.seed ?? 42;
  const base = runLouvain(graph, seed, options.resolution);

  const total = graph.order;
  const sizeCap = Math.max(LARGE_COMMUNITY_MIN_NODES, Math.floor(total * LARGE_COMMUNITY_FRACTION));

  let nextId = 0;
  const groups = groupByCommunity(base);
  const orderedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  for (const [, members] of orderedGroups) {
    const sorted = [...members].sort();
    const oversized = sorted.length > sizeCap;
    const lowCohesion =
      sorted.length >= LOW_COHESION_MIN_NODES &&
      internalDensity(graph, sorted) < LOW_COHESION_DENSITY;

    if (oversized || lowCohesion) {
      const sub = subgraphOf(graph, sorted);
      const subAssignment = runLouvain(sub, seed, options.resolution);
      const subGroups = groupByCommunity(subAssignment);
      const orderedSub = [...subGroups.entries()].sort((a, b) => a[0] - b[0]);
      if (orderedSub.length <= 1) {
        for (const node of sorted) result.set(node, nextId);
        nextId++;
      } else {
        for (const [, subMembers] of orderedSub) {
          for (const node of [...subMembers].sort()) result.set(node, nextId);
          nextId++;
        }
      }
    } else {
      for (const node of sorted) result.set(node, nextId);
      nextId++;
    }
  }

  return result;
}

function runLouvain(graph: CodeGraph, seed: number, resolution?: number): Map<string, number> {
  const raw = graph.raw();
  if (raw.order === 0) return new Map();
  if (raw.size === 0) {
    const isolated = new Map<string, number>();
    let id = 0;
    raw.forEachNode((node) => isolated.set(node, id++));
    return isolated;
  }

  const mapping = louvain(raw, {
    rng: makeRng(seed),
    getEdgeWeight: 'weight',
    ...(resolution === undefined ? {} : { resolution }),
  });
  return new Map(Object.entries(mapping));
}

/**
 * Relabel `current` community ids so they line up with `previous` by majority
 * member overlap, keeping community ids stable across successive runs. Current
 * communities with no clear predecessor get fresh ids above the reused range.
 */
export function remapCommunitiesToPrevious(
  current: Map<string, number>,
  previous: Map<string, number>,
): Map<string, number> {
  const currentGroups = groupByCommunity(current);
  const orderedCurrent = [...currentGroups.entries()].sort((a, b) => a[0] - b[0]);

  const usedPrevious = new Set<number>();
  const remap = new Map<number, number>();

  for (const [currentId, members] of orderedCurrent) {
    const overlap = new Map<number, number>();
    for (const node of members) {
      const prevId = previous.get(node);
      if (prevId === undefined) continue;
      overlap.set(prevId, (overlap.get(prevId) ?? 0) + 1);
    }

    let best: number | undefined;
    let bestCount = 0;
    for (const [prevId, count] of [...overlap.entries()].sort((a, b) => a[0] - b[0])) {
      if (usedPrevious.has(prevId)) continue;
      if (count > bestCount) {
        best = prevId;
        bestCount = count;
      }
    }

    if (best !== undefined) {
      remap.set(currentId, best);
      usedPrevious.add(best);
    }
  }

  let nextFresh = 0;
  const allPrevious = new Set(previous.values());
  for (const id of allPrevious) nextFresh = Math.max(nextFresh, id + 1);
  for (const reused of remap.values()) nextFresh = Math.max(nextFresh, reused + 1);

  for (const [currentId] of orderedCurrent) {
    if (!remap.has(currentId)) remap.set(currentId, nextFresh++);
  }

  const remapped = new Map<string, number>();
  for (const [node, communityId] of current) {
    remapped.set(node, remap.get(communityId) as number);
  }
  return remapped;
}
