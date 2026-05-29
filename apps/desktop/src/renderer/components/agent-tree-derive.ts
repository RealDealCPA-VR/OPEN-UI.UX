import type { AgentRun } from '../../shared/agent-runs';

export interface AgentRunWithParent extends AgentRun {
  parentRunId?: string | null;
}

export interface TreeNode {
  run: AgentRunWithParent;
  depth: number;
  children: TreeNode[];
}

function readParent(run: AgentRunWithParent): string | null {
  const candidate = (run as unknown as { parentRunId?: unknown; parent_run_id?: unknown })
    .parentRunId;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  const snake = (run as unknown as { parent_run_id?: unknown }).parent_run_id;
  if (typeof snake === 'string' && snake.length > 0) return snake;
  return null;
}

function reachableFromAnyRoot(
  childByParent: Map<string, AgentRunWithParent[]>,
  rootIds: Set<string>,
  start: string,
  byId: Map<string, AgentRunWithParent>,
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = start;
  while (cursor !== null) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    if (rootIds.has(cursor)) return true;
    const parentRun = byId.get(cursor);
    if (!parentRun) return false;
    cursor = readParent(parentRun);
  }
  return true;
}

/**
 * Pure tree-builder. Groups runs by parentRunId.
 * - Runs with no parent (or whose parent isn't in the list) are roots.
 * - Cycles are detected and broken: a node whose parent chain loops without
 *   reaching a root is promoted to a root.
 * - Child ordering mirrors input order; root ordering = startedAt desc.
 */
export function buildTree(runs: readonly AgentRunWithParent[]): TreeNode[] {
  const byId = new Map<string, AgentRunWithParent>();
  for (const run of runs) byId.set(run.id, run);

  const childByParent = new Map<string, AgentRunWithParent[]>();
  const rootIds = new Set<string>();

  for (const run of runs) {
    const parent = readParent(run);
    if (parent === null || !byId.has(parent) || parent === run.id) {
      rootIds.add(run.id);
      continue;
    }
    const list = childByParent.get(parent) ?? [];
    list.push(run);
    childByParent.set(parent, list);
  }

  for (const run of runs) {
    if (rootIds.has(run.id)) continue;
    if (!reachableFromAnyRoot(childByParent, rootIds, run.id, byId)) {
      const parent = readParent(run);
      if (parent !== null) {
        const siblings = childByParent.get(parent);
        if (siblings) {
          const idx = siblings.indexOf(run);
          if (idx >= 0) siblings.splice(idx, 1);
          if (siblings.length === 0) childByParent.delete(parent);
        }
      }
      rootIds.add(run.id);
    }
  }

  function buildNode(run: AgentRunWithParent, depth: number, visited: Set<string>): TreeNode {
    if (visited.has(run.id)) {
      return { run, depth, children: [] };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(run.id);
    const kids = childByParent.get(run.id) ?? [];
    return {
      run,
      depth,
      children: kids.map((child) => buildNode(child, depth + 1, nextVisited)),
    };
  }

  const roots: TreeNode[] = [];
  for (const run of runs) {
    if (rootIds.has(run.id)) roots.push(buildNode(run, 0, new Set()));
  }
  roots.sort((a, b) => b.run.startedAt - a.run.startedAt);
  return roots;
}

export function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  function walk(n: TreeNode): void {
    out.push(n);
    for (const c of n.children) walk(c);
  }
  for (const n of nodes) walk(n);
  return out;
}

export function aggregateSubtreeCost(node: TreeNode): {
  inputTokens: number;
  outputTokens: number;
} {
  let inputTokens = node.run.inputTokens;
  let outputTokens = node.run.outputTokens;
  for (const child of node.children) {
    const sub = aggregateSubtreeCost(child);
    inputTokens += sub.inputTokens;
    outputTokens += sub.outputTokens;
  }
  return { inputTokens, outputTokens };
}
