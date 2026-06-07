import {
  setCodeGraphResolver,
  type CodeGraphResolver,
  type CodeGraphQuery,
  type CodeGraphQueryResult,
  type CodeGraphNodeView,
  type CodeGraphEdgeView,
} from '@opencodex/tools';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../storage/db';
import { getWorkspaceByPath } from './workspaces-store';
import {
  callersOf,
  calleesOf,
  neighborsOf,
  pathBetween,
  subsystemOf,
  type CodeGraphNodeRow,
  type CodeGraphEdgeRow,
  type GraphQueryResult,
} from '../rag/code-graph-store';

function toNodeView(row: CodeGraphNodeRow): CodeGraphNodeView {
  const view: CodeGraphNodeView = { id: row.id, label: row.label, file: row.source_file };
  if (row.kind !== null) view.kind = row.kind;
  if (row.language !== null) view.language = row.language;
  if (row.community !== null) view.community = row.community;
  if (row.start_line !== null) view.startLine = row.start_line;
  if (row.end_line !== null) view.endLine = row.end_line;
  return view;
}

function toEdgeView(row: CodeGraphEdgeRow): CodeGraphEdgeView {
  return {
    source: row.source,
    target: row.target,
    relation: row.relation,
    confidence: row.confidence,
  };
}

function toResult(result: GraphQueryResult): CodeGraphQueryResult {
  return {
    nodes: result.nodes.map(toNodeView),
    edges: result.edges.map(toEdgeView),
  };
}

export function buildCodeGraphResolver(
  getDatabase: () => Database.Database = getDb,
): CodeGraphResolver {
  return {
    async query(q: CodeGraphQuery): Promise<CodeGraphQueryResult> {
      const ws = getWorkspaceByPath(resolve(q.workspaceRoot));
      if (!ws || !ws.ragEnabled) {
        return { nodes: [], edges: [], note: 'Code graph is not available for this workspace.' };
      }

      const db = getDatabase();
      switch (q.op) {
        case 'neighbors':
          return toResult(neighborsOf(db, ws.id, q.target, q.limit));
        case 'callers':
          return toResult(callersOf(db, ws.id, q.target, q.limit));
        case 'callees':
          return toResult(calleesOf(db, ws.id, q.target, q.limit));
        case 'path': {
          if (q.target2 === undefined) {
            return { nodes: [], edges: [], note: 'The "path" op requires "target2".' };
          }
          return toResult(pathBetween(db, ws.id, q.target, q.target2));
        }
        case 'subsystem':
          return toResult(subsystemOf(db, ws.id, q.target, q.limit));
      }
    },
  };
}

export function installCodeGraphResolver(): void {
  setCodeGraphResolver(buildCodeGraphResolver());
}

export function uninstallCodeGraphResolver(): void {
  setCodeGraphResolver(null);
}
