import { describe, expect, it } from 'vitest';
import { dedupe } from './dedup';
import { CodeGraph } from './graph';
import type { GraphEdge, GraphNode } from './schema';

function node(id: string, label: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id, label, file_type: 'code', source_file: 'src/a.ts', ...over };
}

function edge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    source,
    target,
    relation: 'calls',
    confidence: 'EXTRACTED',
    confidence_score: 1,
    source_file: 'src/a.ts',
    weight: 1,
    ...over,
  };
}

describe('dedupe', () => {
  it('merges nodes with equal normalized labels', () => {
    const g = new CodeGraph();
    g.addNode(node('a1', 'Foo Bar'));
    g.addNode(node('a2', 'foo_bar'));
    const out = dedupe(g);
    expect(out.order).toBe(1);
  });

  it('chooses the non-chunk-suffixed id as canonical', () => {
    const g = new CodeGraph();
    g.addNode(node('Foo', 'Foo'));
    g.addNode(node('Foo::chunk3', 'Foo'));
    const out = dedupe(g);
    expect(out.order).toBe(1);
    expect(out.hasNode('Foo')).toBe(true);
    expect(out.hasNode('Foo::chunk3')).toBe(false);
  });

  it('tie-breaks by shorter then lexicographic', () => {
    const g = new CodeGraph();
    g.addNode(node('zzzz', 'same'));
    g.addNode(node('bbb', 'same'));
    g.addNode(node('aaa', 'same'));
    const out = dedupe(g);
    expect(out.order).toBe(1);
    expect(out.hasNode('aaa')).toBe(true);
  });

  it('merges nodes above the Jaro-Winkler threshold', () => {
    const g = new CodeGraph();
    g.addNode(node('a', 'getUserName'));
    g.addNode(node('b', 'getUserNam'));
    const out = dedupe(g, 0.92);
    expect(out.order).toBe(1);
  });

  it('does not merge dissimilar labels', () => {
    const g = new CodeGraph();
    g.addNode(node('a', 'apple'));
    g.addNode(node('b', 'zebra'));
    const out = dedupe(g);
    expect(out.order).toBe(2);
  });

  it('rewrites edge endpoints to the canonical id', () => {
    const g = new CodeGraph();
    g.addNode(node('Foo', 'Foo'));
    g.addNode(node('Foo::chunk1', 'Foo'));
    g.addNode(node('caller', 'caller'));
    g.addEdge(edge('caller', 'Foo::chunk1'));
    const out = dedupe(g);
    expect(out.neighbors('caller')).toContain('Foo');
    expect(out.size).toBe(1);
  });

  it('drops self-loops created by a merge', () => {
    const g = new CodeGraph();
    g.addNode(node('Foo', 'Foo'));
    g.addNode(node('Foo::chunk1', 'Foo'));
    g.addEdge(edge('Foo', 'Foo::chunk1'));
    const out = dedupe(g);
    expect(out.order).toBe(1);
    expect(out.size).toBe(0);
  });

  it('is deterministic across runs', () => {
    const build = (): CodeGraph => {
      const g = new CodeGraph();
      g.addNode(node('Foo::chunk2', 'widget'));
      g.addNode(node('Foo', 'widget'));
      g.addNode(node('Bar', 'gadget'));
      return g;
    };
    const a = dedupe(build()).toJson();
    const b = dedupe(build()).toJson();
    expect(a.nodes.map((n) => n.id).sort()).toEqual(b.nodes.map((n) => n.id).sort());
  });
});
