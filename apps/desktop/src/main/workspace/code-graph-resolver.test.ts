import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCodeGraphResolver, setCodeGraphResolver } from '@opencodex/tools';
import { CodeGraph, type GraphEdge, type GraphNode } from '@opencodex/code-graph';
import { rmTmp } from '../../test/rm-tmp';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { createWorkspace, setRagEnabled } from './workspaces-store';
import { persistWorkspaceGraph } from '../rag/code-graph-store';
import {
  buildCodeGraphResolver,
  installCodeGraphResolver,
  uninstallCodeGraphResolver,
} from './code-graph-resolver';

let db: Database.Database;
let tmp: string;

function node(id: string, label: string): GraphNode {
  return {
    id,
    label,
    file_type: 'code',
    source_file: id.split('::')[0] ?? id,
    source_location: { startLine: 1, endLine: 3 },
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

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-cg-resolver-'));
});

afterEach(async () => {
  uninstallCodeGraphResolver();
  setDbForTesting(null);
  db.close();
  await rmTmp(tmp);
});

describe('buildCodeGraphResolver', () => {
  it('maps store rows to node/edge views for a workspace', async () => {
    const ws = createWorkspace({ path: tmp, setPrimary: true });
    const graph = new CodeGraph();
    graph.addNode(node('a.ts::alpha', 'alpha'));
    graph.addNode(node('a.ts::beta', 'beta'));
    graph.addEdge(callEdge('a.ts::alpha', 'a.ts::beta'));
    persistWorkspaceGraph(
      db,
      ws.id,
      graph,
      new Map([
        ['a.ts::alpha', 0],
        ['a.ts::beta', 0],
      ]),
    );

    const resolver = buildCodeGraphResolver(() => db);
    const result = await resolver.query({ workspaceRoot: tmp, op: 'callees', target: 'alpha' });
    expect(result.nodes.map((n) => n.id)).toContain('a.ts::beta');
    const view = result.nodes.find((n) => n.id === 'a.ts::beta');
    expect(view?.file).toBe('a.ts');
    expect(view?.kind).toBe('function');
    expect(view?.language).toBe('typescript');
    expect(result.edges[0]?.relation).toBe('calls');
  });

  it('returns a note when the workspace is unknown or rag-disabled', async () => {
    const ws = createWorkspace({ path: tmp, setPrimary: true });
    setRagEnabled(ws.id, false);
    const resolver = buildCodeGraphResolver(() => db);
    const result = await resolver.query({ workspaceRoot: tmp, op: 'neighbors', target: 'alpha' });
    expect(result.nodes).toEqual([]);
    expect(result.note).toBeDefined();
  });

  it('requires target2 for the path op', async () => {
    createWorkspace({ path: tmp, setPrimary: true });
    const resolver = buildCodeGraphResolver(() => db);
    const result = await resolver.query({ workspaceRoot: tmp, op: 'path', target: 'alpha' });
    expect(result.note).toMatch(/target2/);
  });
});

describe('installCodeGraphResolver', () => {
  it('registers and unregisters the module-level resolver', () => {
    installCodeGraphResolver();
    expect(getCodeGraphResolver()).not.toBeNull();
    uninstallCodeGraphResolver();
    expect(getCodeGraphResolver()).toBeNull();
  });

  it('survives explicit reset', () => {
    installCodeGraphResolver();
    setCodeGraphResolver(null);
    expect(getCodeGraphResolver()).toBeNull();
  });
});
