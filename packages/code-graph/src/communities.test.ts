import { describe, expect, it } from 'vitest';
import { detectCommunities, remapCommunitiesToPrevious } from './communities';
import { CodeGraph } from './graph';
import type { GraphEdge, GraphNode } from './schema';

function node(id: string): GraphNode {
  return { id, label: id, file_type: 'code', source_file: 'src/a.ts' };
}

function edge(source: string, target: string): GraphEdge {
  return {
    source,
    target,
    relation: 'calls',
    confidence: 'EXTRACTED',
    confidence_score: 1,
    source_file: 'src/a.ts',
    weight: 1,
  };
}

function clique(g: CodeGraph, ids: string[]): void {
  for (const id of ids) g.addNode(node(id));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      g.addEdge(edge(ids[i] as string, ids[j] as string));
      g.addEdge(edge(ids[j] as string, ids[i] as string));
    }
  }
}

describe('detectCommunities', () => {
  it('returns an empty map for an empty graph', () => {
    expect(detectCommunities(new CodeGraph()).size).toBe(0);
  });

  it('assigns isolated nodes to distinct communities', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('b'));
    const c = detectCommunities(g);
    expect(c.get('a')).not.toBe(c.get('b'));
  });

  it('groups nodes of a dense cluster into the same community', () => {
    const g = new CodeGraph();
    clique(g, ['a1', 'a2', 'a3', 'a4']);
    clique(g, ['b1', 'b2', 'b3', 'b4']);
    g.addEdge(edge('a1', 'b1')); // single weak bridge

    const c = detectCommunities(g);
    expect(c.get('a1')).toBe(c.get('a2'));
    expect(c.get('a1')).toBe(c.get('a3'));
    expect(c.get('b1')).toBe(c.get('b2'));
    expect(c.get('a1')).not.toBe(c.get('b1'));
  });

  it('is deterministic with a fixed seed', () => {
    const build = (): CodeGraph => {
      const g = new CodeGraph();
      clique(g, ['a1', 'a2', 'a3']);
      clique(g, ['b1', 'b2', 'b3']);
      g.addEdge(edge('a1', 'b1'));
      return g;
    };
    const first = detectCommunities(build(), { seed: 7 });
    const second = detectCommunities(build(), { seed: 7 });
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });

  it('splits an oversized community that has internal sub-structure', () => {
    // Two tight cliques joined by several bridges so base Louvain folds them
    // into one community that exceeds 25% of the graph. The split heuristic
    // re-partitions it and recovers the two sub-cliques.
    const g = new CodeGraph();
    const left = Array.from({ length: 8 }, (_, i) => `l${i}`);
    const right = Array.from({ length: 8 }, (_, i) => `r${i}`);
    clique(g, left);
    clique(g, right);
    for (let i = 0; i < 4; i++) {
      g.addEdge(edge(left[i] as string, right[i] as string));
      g.addEdge(edge(right[i] as string, left[i] as string));
    }

    const baseCount = new Set(detectCommunities(g, { resolution: 0.4 }).values()).size;
    const splitCount = new Set(detectCommunities(g).values()).size;
    expect(splitCount).toBeGreaterThanOrEqual(baseCount);
    expect(splitCount).toBeGreaterThan(1);
  });
});

describe('remapCommunitiesToPrevious', () => {
  it('keeps stable ids when membership is unchanged', () => {
    const previous = new Map([
      ['a', 5],
      ['b', 5],
      ['c', 9],
    ]);
    const current = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 1],
    ]);
    const remapped = remapCommunitiesToPrevious(current, previous);
    expect(remapped.get('a')).toBe(5);
    expect(remapped.get('b')).toBe(5);
    expect(remapped.get('c')).toBe(9);
  });

  it('maps by majority overlap', () => {
    const previous = new Map([
      ['a', 2],
      ['b', 2],
      ['c', 2],
      ['d', 8],
    ]);
    // current community 0 mostly overlaps previous 2.
    const current = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 0],
      ['d', 0],
    ]);
    const remapped = remapCommunitiesToPrevious(current, previous);
    expect(remapped.get('a')).toBe(2);
  });

  it('assigns fresh ids to communities with no predecessor', () => {
    const previous = new Map([['a', 3]]);
    const current = new Map([
      ['a', 0],
      ['newNode', 1],
    ]);
    const remapped = remapCommunitiesToPrevious(current, previous);
    expect(remapped.get('a')).toBe(3);
    expect(remapped.get('newNode')).toBeGreaterThan(3);
  });

  it('does not reuse a previous id for two current communities', () => {
    const previous = new Map([
      ['a', 1],
      ['b', 1],
    ]);
    const current = new Map([
      ['a', 0],
      ['b', 5],
    ]);
    const remapped = remapCommunitiesToPrevious(current, previous);
    expect(remapped.get('a')).not.toBe(remapped.get('b'));
  });
});
