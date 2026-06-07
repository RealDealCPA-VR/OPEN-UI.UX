import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeGraph, type GraphEdge, type GraphNode } from '@opencodex/code-graph';
import { applyMigrations } from '../storage/db';
import {
  callersOf,
  calleesOf,
  clearWorkspaceGraph,
  getWorkspaceGraph,
  neighborsOf,
  pathBetween,
  persistWorkspaceGraph,
  resolveNode,
  subsystemOf,
} from './code-graph-store';

const WS = 'ws-1';

function node(id: string, label: string): GraphNode {
  const sourceFile = id.split('::')[0] ?? id;
  return {
    id,
    label,
    file_type: 'code',
    source_file: sourceFile,
    source_location: { startLine: 1, endLine: 5 },
    metadata: { language: 'typescript', kind: 'function' },
  };
}

function callEdge(source: string, target: string): GraphEdge {
  return {
    source,
    target,
    relation: 'calls',
    confidence: 'EXTRACTED',
    confidence_score: 0.9,
    weight: 1,
    source_file: 'a.ts',
  };
}

// a.ts: alpha -> beta -> gamma ; delta is isolated in a separate community.
function seedGraph(): { graph: CodeGraph; communities: Map<string, number> } {
  const graph = new CodeGraph();
  graph.addNode(node('a.ts::alpha', 'alpha'));
  graph.addNode(node('a.ts::beta', 'beta'));
  graph.addNode(node('a.ts::gamma', 'gamma'));
  graph.addNode(node('b.ts::delta', 'delta'));
  graph.addEdge(callEdge('a.ts::alpha', 'a.ts::beta'));
  graph.addEdge(callEdge('a.ts::beta', 'a.ts::gamma'));

  const communities = new Map<string, number>([
    ['a.ts::alpha', 0],
    ['a.ts::beta', 0],
    ['a.ts::gamma', 0],
    ['b.ts::delta', 1],
  ]);
  return { graph, communities };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  const { graph, communities } = seedGraph();
  persistWorkspaceGraph(db, WS, graph, communities);
});

afterEach(() => {
  db.close();
});

describe('persistWorkspaceGraph', () => {
  it('writes nodes and edges with community stamping', () => {
    const nodes = db.prepare('SELECT * FROM code_graph_nodes WHERE workspace_id = ?').all(WS);
    const edges = db.prepare('SELECT * FROM code_graph_edges WHERE workspace_id = ?').all(WS);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(2);
    const beta = resolveNode(db, WS, 'a.ts::beta');
    expect(beta?.community).toBe(0);
    expect(beta?.language).toBe('typescript');
    expect(beta?.kind).toBe('function');
  });

  it('replaces a workspace transactionally on re-persist', () => {
    const graph = new CodeGraph();
    graph.addNode(node('c.ts::only', 'only'));
    persistWorkspaceGraph(db, WS, graph, new Map([['c.ts::only', 0]]));
    const nodes = db.prepare('SELECT id FROM code_graph_nodes WHERE workspace_id = ?').all(WS);
    expect(nodes.map((n) => (n as { id: string }).id)).toEqual(['c.ts::only']);
  });

  it('isolates per-workspace rows', () => {
    const { graph, communities } = seedGraph();
    persistWorkspaceGraph(db, 'ws-2', graph, communities);
    clearWorkspaceGraph(db, 'ws-2');
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM code_graph_nodes WHERE workspace_id = ?').get('ws-2'),
    ).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM code_graph_nodes WHERE workspace_id = ?').get(WS),
    ).toEqual({ n: 4 });
  });
});

describe('resolveNode', () => {
  it('resolves by exact id', () => {
    expect(resolveNode(db, WS, 'a.ts::beta')?.id).toBe('a.ts::beta');
  });
  it('resolves by normalized label', () => {
    expect(resolveNode(db, WS, 'Beta')?.id).toBe('a.ts::beta');
  });
  it('returns undefined for unknown targets', () => {
    expect(resolveNode(db, WS, 'nope')).toBeUndefined();
  });
});

describe('neighborsOf', () => {
  it('returns both in- and out-neighbors', () => {
    const result = neighborsOf(db, WS, 'beta');
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['a.ts::alpha', 'a.ts::beta', 'a.ts::gamma']);
    expect(result.edges).toHaveLength(2);
  });
  it('returns empty for unknown targets', () => {
    expect(neighborsOf(db, WS, 'missing')).toEqual({ nodes: [], edges: [] });
  });
});

describe('callersOf / calleesOf', () => {
  it('callersOf follows incoming calls edges', () => {
    const result = callersOf(db, WS, 'beta');
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('a.ts::alpha');
    expect(ids).not.toContain('a.ts::gamma');
  });
  it('calleesOf follows outgoing calls edges', () => {
    const result = calleesOf(db, WS, 'beta');
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('a.ts::gamma');
    expect(ids).not.toContain('a.ts::alpha');
  });
});

describe('pathBetween', () => {
  it('finds the shortest chain', () => {
    const result = pathBetween(db, WS, 'alpha', 'gamma');
    expect(result.nodes.map((n) => n.id)).toEqual(['a.ts::alpha', 'a.ts::beta', 'a.ts::gamma']);
    expect(result.edges).toHaveLength(2);
  });
  it('returns empty when no path exists', () => {
    expect(pathBetween(db, WS, 'alpha', 'delta')).toEqual({ nodes: [], edges: [] });
  });
});

describe('getWorkspaceGraph', () => {
  it('returns every node and only edges within the returned set', () => {
    const result = getWorkspaceGraph(db, WS);
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'a.ts::alpha',
      'a.ts::beta',
      'a.ts::gamma',
      'b.ts::delta',
    ]);
    expect(result.edges).toHaveLength(2);
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(result.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it('caps the node set and drops edges whose endpoints fall outside the cap', () => {
    const result = getWorkspaceGraph(db, WS, { limit: 2 });
    expect(result.nodes).toHaveLength(2);
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(result.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(result.edges.length).toBeLessThanOrEqual(1);
  });

  it('orders higher-degree nodes first', () => {
    const result = getWorkspaceGraph(db, WS, { limit: 1 });
    expect(result.nodes[0]?.id).toBe('a.ts::beta');
  });

  it('returns an empty graph for an unknown workspace', () => {
    expect(getWorkspaceGraph(db, 'nope')).toEqual({ nodes: [], edges: [] });
  });
});

describe('subsystemOf', () => {
  it('returns nodes sharing the target community', () => {
    const result = subsystemOf(db, WS, 'beta');
    expect(result.nodes.map((n) => n.id).sort()).toEqual([
      'a.ts::alpha',
      'a.ts::beta',
      'a.ts::gamma',
    ]);
    expect(result.nodes.every((n) => n.community === 0)).toBe(true);
  });
  it('isolates a different community', () => {
    const result = subsystemOf(db, WS, 'delta');
    expect(result.nodes.map((n) => n.id)).toEqual(['b.ts::delta']);
  });
});
