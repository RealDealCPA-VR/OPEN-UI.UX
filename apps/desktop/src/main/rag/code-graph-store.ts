import type Database from 'better-sqlite3';
import { normalizeLabel, type CodeGraph, type GraphNode } from '@opencodex/code-graph';

export interface CodeGraphNodeRow {
  id: string;
  label: string;
  file_type: string;
  source_file: string;
  start_line: number | null;
  end_line: number | null;
  language: string | null;
  kind: string | null;
  community: number | null;
}

export interface CodeGraphEdgeRow {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  confidence_score: number;
  weight: number;
  source_file: string;
}

function metadataString(node: GraphNode, key: string): string | null {
  const value = node.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Replace this workspace's persisted graph with `graph`, stamping each node with
 * its `communities` index. DELETE-then-INSERT inside one transaction so a reader
 * never observes a half-written graph.
 */
export function persistWorkspaceGraph(
  db: Database.Database,
  workspaceId: string,
  graph: CodeGraph,
  communities: Map<string, number>,
): void {
  const { nodes, edges } = graph.toJson();

  const insertNode = db.prepare(
    `INSERT OR REPLACE INTO code_graph_nodes
       (workspace_id, id, label, file_type, source_file, start_line, end_line, language, kind, community)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO code_graph_edges
       (workspace_id, source, target, relation, confidence, confidence_score, weight, source_file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM code_graph_nodes WHERE workspace_id = ?`).run(workspaceId);
    db.prepare(`DELETE FROM code_graph_edges WHERE workspace_id = ?`).run(workspaceId);

    for (const node of nodes) {
      insertNode.run(
        workspaceId,
        node.id,
        node.label,
        node.file_type,
        node.source_file,
        node.source_location?.startLine ?? null,
        node.source_location?.endLine ?? null,
        metadataString(node, 'language'),
        metadataString(node, 'kind'),
        communities.get(node.id) ?? null,
      );
    }

    for (const edge of edges) {
      insertEdge.run(
        workspaceId,
        edge.source,
        edge.target,
        edge.relation,
        edge.confidence,
        edge.confidence_score,
        edge.weight,
        edge.source_file,
      );
    }
  });
  tx();
}

export function clearWorkspaceGraph(db: Database.Database, workspaceId: string): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM code_graph_nodes WHERE workspace_id = ?`).run(workspaceId);
    db.prepare(`DELETE FROM code_graph_edges WHERE workspace_id = ?`).run(workspaceId);
  });
  tx();
}

const NODE_COLUMNS = `id, label, file_type, source_file, start_line, end_line, language, kind, community`;

function nodeById(
  db: Database.Database,
  workspaceId: string,
  id: string,
): CodeGraphNodeRow | undefined {
  return db
    .prepare(`SELECT ${NODE_COLUMNS} FROM code_graph_nodes WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id) as CodeGraphNodeRow | undefined;
}

/**
 * Resolve a user-supplied `target` to a single node. Prefers an exact id match,
 * then falls back to a normalized-label match (the deterministic key the graph
 * builder dedups on). When several labels collide, the lexicographically
 * smallest id wins so resolution is stable across calls.
 */
export function resolveNode(
  db: Database.Database,
  workspaceId: string,
  target: string,
): CodeGraphNodeRow | undefined {
  const exact = nodeById(db, workspaceId, target);
  if (exact) return exact;

  const wanted = normalizeLabel(target);
  const rows = db
    .prepare(`SELECT ${NODE_COLUMNS} FROM code_graph_nodes WHERE workspace_id = ? ORDER BY id ASC`)
    .all(workspaceId) as CodeGraphNodeRow[];
  for (const row of rows) {
    if (normalizeLabel(row.label) === wanted) return row;
  }
  return undefined;
}

const DEFAULT_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), 200);
}

function nodesByIds(
  db: Database.Database,
  workspaceId: string,
  ids: readonly string[],
): CodeGraphNodeRow[] {
  const out: CodeGraphNodeRow[] = [];
  for (const id of ids) {
    const row = nodeById(db, workspaceId, id);
    if (row) out.push(row);
  }
  return out;
}

export interface GraphQueryResult {
  nodes: CodeGraphNodeRow[];
  edges: CodeGraphEdgeRow[];
}

function edgesTouching(
  db: Database.Database,
  workspaceId: string,
  ids: ReadonlySet<string>,
): CodeGraphEdgeRow[] {
  if (ids.size === 0) return [];
  const all = db
    .prepare(
      `SELECT source, target, relation, confidence, confidence_score, weight, source_file
       FROM code_graph_edges WHERE workspace_id = ?`,
    )
    .all(workspaceId) as CodeGraphEdgeRow[];
  return all.filter((e) => ids.has(e.source) && ids.has(e.target));
}

/** Symbols directly connected to `target` in either direction. */
export function neighborsOf(
  db: Database.Database,
  workspaceId: string,
  target: string,
  limit?: number,
): GraphQueryResult {
  const node = resolveNode(db, workspaceId, target);
  if (!node) return { nodes: [], edges: [] };
  const cap = clampLimit(limit);

  const out = db
    .prepare(`SELECT target AS id FROM code_graph_edges WHERE workspace_id = ? AND source = ?`)
    .all(workspaceId, node.id) as { id: string }[];
  const incoming = db
    .prepare(`SELECT source AS id FROM code_graph_edges WHERE workspace_id = ? AND target = ?`)
    .all(workspaceId, node.id) as { id: string }[];

  const neighborIds = new Set<string>();
  for (const r of [...out, ...incoming]) {
    if (r.id !== node.id) neighborIds.add(r.id);
  }
  const limited = [...neighborIds].slice(0, cap);

  const nodes = [node, ...nodesByIds(db, workspaceId, limited)];
  const idSet = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edgesTouching(db, workspaceId, idSet) };
}

/** Symbols that call `target` (follow incoming 'calls' edges). */
export function callersOf(
  db: Database.Database,
  workspaceId: string,
  target: string,
  limit?: number,
): GraphQueryResult {
  return directedCalls(db, workspaceId, target, 'target', 'source', limit);
}

/** Symbols that `target` calls (follow outgoing 'calls' edges). */
export function calleesOf(
  db: Database.Database,
  workspaceId: string,
  target: string,
  limit?: number,
): GraphQueryResult {
  return directedCalls(db, workspaceId, target, 'source', 'target', limit);
}

function directedCalls(
  db: Database.Database,
  workspaceId: string,
  target: string,
  anchorCol: 'source' | 'target',
  otherCol: 'source' | 'target',
  limit?: number,
): GraphQueryResult {
  const node = resolveNode(db, workspaceId, target);
  if (!node) return { nodes: [], edges: [] };
  const cap = clampLimit(limit);

  const rows = db
    .prepare(
      `SELECT ${otherCol} AS id FROM code_graph_edges
       WHERE workspace_id = ? AND relation = 'calls' AND ${anchorCol} = ?`,
    )
    .all(workspaceId, node.id) as { id: string }[];

  const otherIds = new Set<string>();
  for (const r of rows) if (r.id !== node.id) otherIds.add(r.id);
  const limited = [...otherIds].slice(0, cap);

  const nodes = [node, ...nodesByIds(db, workspaceId, limited)];
  const idSet = new Set(nodes.map((n) => n.id));
  const edges = edgesTouching(db, workspaceId, idSet).filter((e) => e.relation === 'calls');
  return { nodes, edges };
}

/**
 * Shortest path between two symbols via bounded BFS over the directed edge set,
 * trying both directions so an undirected relationship chain is found regardless
 * of how the user ordered the endpoints.
 */
export function pathBetween(
  db: Database.Database,
  workspaceId: string,
  fromTarget: string,
  toTarget: string,
): GraphQueryResult {
  const from = resolveNode(db, workspaceId, fromTarget);
  const to = resolveNode(db, workspaceId, toTarget);
  if (!from || !to) return { nodes: [], edges: [] };

  const all = db
    .prepare(
      `SELECT source, target, relation, confidence, confidence_score, weight, source_file
       FROM code_graph_edges WHERE workspace_id = ?`,
    )
    .all(workspaceId) as CodeGraphEdgeRow[];

  const adjacency = new Map<string, string[]>();
  for (const e of all) {
    const fwd = adjacency.get(e.source) ?? [];
    fwd.push(e.target);
    adjacency.set(e.source, fwd);
    const rev = adjacency.get(e.target) ?? [];
    rev.push(e.source);
    adjacency.set(e.target, rev);
  }

  const pathIds = bfsPath(adjacency, from.id, to.id);
  if (pathIds === null) return { nodes: [], edges: [] };

  const nodes = nodesByIds(db, workspaceId, pathIds);
  const idSet = new Set(pathIds);
  const wanted = new Set<string>();
  for (let i = 0; i + 1 < pathIds.length; i++) {
    wanted.add(`${pathIds[i]}\0${pathIds[i + 1]}`);
    wanted.add(`${pathIds[i + 1]}\0${pathIds[i]}`);
  }
  const edges = edgesTouching(db, workspaceId, idSet).filter((e) =>
    wanted.has(`${e.source}\0${e.target}`),
  );
  return { nodes, edges };
}

function bfsPath(
  adjacency: ReadonlyMap<string, string[]>,
  start: string,
  goal: string,
): string[] | null {
  if (start === goal) return [start];
  const previous = new Map<string, string>();
  const visited = new Set<string>([start]);
  let frontier = [start];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        previous.set(neighbor, node);
        if (neighbor === goal) return reconstruct(previous, start, goal);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
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

const WORKSPACE_GRAPH_DEFAULT_LIMIT = 500;
const WORKSPACE_GRAPH_MAX_LIMIT = 2000;

function clampWorkspaceGraphLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return WORKSPACE_GRAPH_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), WORKSPACE_GRAPH_MAX_LIMIT);
}

/**
 * The whole persisted graph for a workspace, capped at `opts.limit` nodes
 * (default 500). Nodes are ordered by degree (most-connected first) so a
 * truncated view still surfaces the structural hubs; edges are restricted to
 * the returned node set so the renderer never references a missing endpoint.
 */
export function getWorkspaceGraph(
  db: Database.Database,
  workspaceId: string,
  opts?: { limit?: number },
): GraphQueryResult {
  const cap = clampWorkspaceGraphLimit(opts?.limit);

  const nodes = db
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM code_graph_nodes n
       WHERE workspace_id = ?
       ORDER BY (
         SELECT COUNT(*) FROM code_graph_edges e
         WHERE e.workspace_id = n.workspace_id AND (e.source = n.id OR e.target = n.id)
       ) DESC, n.id ASC
       LIMIT ?`,
    )
    .all(workspaceId, cap) as CodeGraphNodeRow[];

  const idSet = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edgesTouching(db, workspaceId, idSet) };
}

/** All nodes sharing `target`'s community (its subsystem/cluster). */
export function subsystemOf(
  db: Database.Database,
  workspaceId: string,
  target: string,
  limit?: number,
): GraphQueryResult {
  const node = resolveNode(db, workspaceId, target);
  if (!node || node.community === null) {
    return { nodes: node ? [node] : [], edges: [] };
  }
  const cap = clampLimit(limit);

  const nodes = db
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM code_graph_nodes
       WHERE workspace_id = ? AND community = ? ORDER BY id ASC LIMIT ?`,
    )
    .all(workspaceId, node.community, cap) as CodeGraphNodeRow[];

  const idSet = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edgesTouching(db, workspaceId, idSet) };
}
