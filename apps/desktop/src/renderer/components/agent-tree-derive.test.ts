import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';
import {
  aggregateSubtreeCost,
  buildTree,
  flattenTree,
  type AgentRunWithParent,
} from './agent-tree-derive';

function makeRun(
  id: string,
  parentRunId: string | null = null,
  overrides: Partial<AgentRun> = {},
): AgentRunWithParent {
  const base: AgentRun = {
    id,
    task: `task ${id}`,
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    runnerId: 'internal',
    status: 'running',
    startedAt: Date.parse('2026-05-28T00:00:00Z') + Number.parseInt(id, 36),
    completedAt: null,
    inputTokens: 10,
    outputTokens: 5,
    iterations: 1,
    toolEvents: [],
    stopReason: null,
    error: null,
    worktreePath: null,
    worktreeBranch: null,
    worktreeRepoRoot: null,
    mergeStatus: null,
    triggerSource: 'user',
    scheduledTaskId: null,
    ...overrides,
  };
  return { ...base, parentRunId };
}

describe('agent-tree-derive', () => {
  describe('buildTree', () => {
    it('returns an empty array for no runs', () => {
      expect(buildTree([])).toEqual([]);
    });

    it('treats a single run with no parent as a root', () => {
      const tree = buildTree([makeRun('a')]);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.depth).toBe(0);
      expect(tree[0]!.children).toEqual([]);
    });

    it('groups children under their parent', () => {
      const tree = buildTree([
        makeRun('root'),
        makeRun('childA', 'root'),
        makeRun('childB', 'root'),
      ]);
      expect(tree).toHaveLength(1);
      const root = tree[0]!;
      expect(root.run.id).toBe('root');
      expect(root.children.map((c) => c.run.id).sort()).toEqual(['childA', 'childB']);
      for (const c of root.children) expect(c.depth).toBe(1);
    });

    it('supports nested grandchildren', () => {
      const tree = buildTree([makeRun('root'), makeRun('mid', 'root'), makeRun('leaf', 'mid')]);
      const root = tree[0]!;
      const mid = root.children[0]!;
      const leaf = mid.children[0]!;
      expect(mid.run.id).toBe('mid');
      expect(leaf.run.id).toBe('leaf');
      expect(leaf.depth).toBe(2);
    });

    it('promotes runs whose parent is unknown to roots (orphans)', () => {
      const tree = buildTree([makeRun('orphan', 'missing-parent')]);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.run.id).toBe('orphan');
      expect(tree[0]!.depth).toBe(0);
    });

    it('orders roots by startedAt descending', () => {
      const older = makeRun('older', null, { startedAt: 1_000 });
      const newer = makeRun('newer', null, { startedAt: 5_000 });
      const tree = buildTree([older, newer]);
      expect(tree.map((n) => n.run.id)).toEqual(['newer', 'older']);
    });

    it('breaks two-node cycles by promoting nodes to roots', () => {
      const a = makeRun('a', 'b');
      const b = makeRun('b', 'a');
      const tree = buildTree([a, b]);
      const ids = tree.map((n) => n.run.id).sort();
      expect(ids).toEqual(['a', 'b']);
      for (const node of tree) {
        expect(node.children).toEqual([]);
      }
    });

    it('breaks self-cycles by treating the node as a root', () => {
      const self = makeRun('self', 'self');
      const tree = buildTree([self]);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.run.id).toBe('self');
    });

    it('handles a mix of trees, orphans, and cycles together', () => {
      const runs = [
        makeRun('root'),
        makeRun('c1', 'root'),
        makeRun('orphan', 'ghost'),
        makeRun('loopA', 'loopB'),
        makeRun('loopB', 'loopA'),
      ];
      const tree = buildTree(runs);
      const ids = new Set(tree.map((n) => n.run.id));
      expect(ids.has('root')).toBe(true);
      expect(ids.has('orphan')).toBe(true);
      expect(ids.has('loopA')).toBe(true);
      expect(ids.has('loopB')).toBe(true);
      const rootNode = tree.find((n) => n.run.id === 'root')!;
      expect(rootNode.children.map((c) => c.run.id)).toEqual(['c1']);
    });
  });

  describe('flattenTree', () => {
    it('walks children depth-first', () => {
      const tree = buildTree([
        makeRun('root'),
        makeRun('a', 'root'),
        makeRun('b', 'root'),
        makeRun('a1', 'a'),
      ]);
      const flat = flattenTree(tree);
      expect(flat.map((n) => n.run.id)).toEqual(['root', 'a', 'a1', 'b']);
    });
  });

  describe('aggregateSubtreeCost', () => {
    it('sums tokens of a node and all descendants', () => {
      const tree = buildTree([
        makeRun('root', null, { inputTokens: 100, outputTokens: 50 }),
        makeRun('child', 'root', { inputTokens: 10, outputTokens: 5 }),
        makeRun('grand', 'child', { inputTokens: 1, outputTokens: 2 }),
      ]);
      const root = tree[0]!;
      const totals = aggregateSubtreeCost(root);
      expect(totals.inputTokens).toBe(111);
      expect(totals.outputTokens).toBe(57);
    });
  });
});
