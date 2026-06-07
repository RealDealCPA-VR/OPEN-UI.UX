import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtractionResult } from '@opencodex/code-graph';
import { applyMigrations } from '../storage/db';
import { buildGraphFromExtractions, rebuildWorkspaceGraph } from './code-graph-builder';
import { calleesOf, callersOf, neighborsOf, persistWorkspaceGraph } from './code-graph-store';

const WS = 'ws-build';

// alpha (a.ts) imports + calls beta (b.ts).
function extractionA(): ExtractionResult {
  return {
    symbols: [
      {
        id: 'a.ts::alpha',
        label: 'alpha',
        kind: 'function',
        sourceFile: 'a.ts',
        language: 'typescript',
        location: { startLine: 1, endLine: 6 },
      },
    ],
    calls: [
      {
        callerId: 'a.ts::alpha',
        calleeLabel: 'beta',
        isMemberCall: false,
        sourceFile: 'a.ts',
        location: { startLine: 3, endLine: 3 },
      },
    ],
    imports: [{ moduleStem: 'b', symbol: 'beta', sourceFile: 'a.ts' }],
  };
}

function extractionB(): ExtractionResult {
  return {
    symbols: [
      {
        id: 'b.ts::beta',
        label: 'beta',
        kind: 'function',
        sourceFile: 'b.ts',
        language: 'typescript',
        location: { startLine: 1, endLine: 4 },
      },
    ],
    calls: [],
    imports: [],
  };
}

describe('buildGraphFromExtractions', () => {
  it('merges extractions and resolves cross-file call edges', () => {
    const { graph, communities } = buildGraphFromExtractions([extractionA(), extractionB()]);
    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(communities.size).toBe(2);
    const json = graph.toJson();
    const callEdge = json.edges.find((e) => e.relation === 'calls');
    expect(callEdge).toBeDefined();
    expect(callEdge?.source).toBe('a.ts::alpha');
    expect(callEdge?.target).toBe('b.ts::beta');
  });

  it('produces an empty graph from no extractions', () => {
    const { graph, communities } = buildGraphFromExtractions([]);
    expect(graph.order).toBe(0);
    expect(communities.size).toBe(0);
  });
});

describe('rebuildWorkspaceGraph', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  // No grammar is registered in tests, so extractSymbols returns empty: drive
  // persistence directly via buildGraphFromExtractions to assert queryability.
  it('persists a built graph that the store can query', () => {
    const { graph, communities } = buildGraphFromExtractions([extractionA(), extractionB()]);
    persistWorkspaceGraph(db, WS, graph, communities);

    expect(callersOf(db, WS, 'beta').nodes.map((n) => n.id)).toContain('a.ts::alpha');
    expect(calleesOf(db, WS, 'alpha').nodes.map((n) => n.id)).toContain('b.ts::beta');
    expect(neighborsOf(db, WS, 'alpha').nodes).toHaveLength(2);
  });

  it('skips files with no detectable language and persists an empty graph', async () => {
    const built = await rebuildWorkspaceGraph(db, WS, [
      { file: 'README', content: 'no language here' },
      { file: 'data.unknownext', content: 'x' },
    ]);
    expect(built.graph.order).toBe(0);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM code_graph_nodes WHERE workspace_id = ?')
      .get(WS);
    expect(rows).toEqual({ n: 0 });
  });
});
