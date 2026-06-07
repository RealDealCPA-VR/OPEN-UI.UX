import { describe, expect, it } from 'vitest';
import { CodeGraph, languageFamilyOf } from './graph';
import type { GraphEdge, GraphNode } from './schema';

function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    file_type: 'code',
    source_file: 'src/a.ts',
    ...over,
  };
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

describe('CodeGraph.addNode', () => {
  it('is idempotent on the same id', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('a'));
    expect(g.order).toBe(1);
  });

  it('is last-write-wins on attributes', () => {
    const g = new CodeGraph();
    g.addNode(node('a', { label: 'first' }));
    g.addNode(node('a', { label: 'second', file_type: 'document' }));
    const stored = g.getNode('a');
    expect(stored?.label).toBe('second');
    expect(stored?.file_type).toBe('document');
  });
});

describe('CodeGraph.addEdge', () => {
  it('inserts an edge between existing nodes', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('b'));
    expect(g.addEdge(edge('a', 'b'))).toBe(true);
    expect(g.size).toBe(1);
    expect(g.neighbors('a')).toContain('b');
  });

  it('drops dangling edges to missing endpoints silently', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    expect(g.addEdge(edge('a', 'external_stdlib'))).toBe(false);
    expect(g.size).toBe(0);
  });

  it('resolves endpoints by normalized label', () => {
    const g = new CodeGraph();
    g.addNode(node('mod::Foo', { label: 'Foo Bar' }));
    g.addNode(node('mod::Baz', { label: 'Baz' }));
    expect(g.addEdge(edge('foo_bar', 'Baz'))).toBe(true);
    expect(g.neighbors('mod::Foo')).toContain('mod::Baz');
  });

  it('preserves direction', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('b'));
    g.addEdge(edge('a', 'b'));
    expect(g.neighbors('a')).toContain('b');
    expect(g.callersOf('b')).toContain('a');
    expect(g.callersOf('a')).not.toContain('b');
  });

  it('drops cross-language INFERRED calls edges', () => {
    const g = new CodeGraph();
    g.addNode(node('ts_fn', { source_file: 'src/a.ts' }));
    g.addNode(node('py_fn', { source_file: 'src/b.py' }));
    const dropped = g.addEdge(
      edge('ts_fn', 'py_fn', { relation: 'calls', confidence: 'INFERRED' }),
    );
    expect(dropped).toBe(false);
    expect(g.size).toBe(0);
  });

  it('keeps cross-language EXTRACTED calls edges', () => {
    const g = new CodeGraph();
    g.addNode(node('ts_fn', { source_file: 'src/a.ts' }));
    g.addNode(node('py_fn', { source_file: 'src/b.py' }));
    expect(g.addEdge(edge('ts_fn', 'py_fn', { relation: 'calls', confidence: 'EXTRACTED' }))).toBe(
      true,
    );
  });

  it('keeps same-language INFERRED calls edges', () => {
    const g = new CodeGraph();
    g.addNode(node('ts_a', { source_file: 'src/a.ts' }));
    g.addNode(node('ts_b', { source_file: 'src/b.tsx' }));
    expect(g.addEdge(edge('ts_a', 'ts_b', { relation: 'calls', confidence: 'INFERRED' }))).toBe(
      true,
    );
  });

  it('uses metadata.language over file extension', () => {
    const g = new CodeGraph();
    g.addNode(node('a', { source_file: 'a.unknown', metadata: { language: 'typescript' } }));
    g.addNode(node('b', { source_file: 'b.unknown', metadata: { language: 'python' } }));
    expect(g.addEdge(edge('a', 'b', { relation: 'calls', confidence: 'INFERRED' }))).toBe(false);
  });
});

describe('CodeGraph traversal', () => {
  it('pathBetween finds the BFS shortest directed path', () => {
    const g = new CodeGraph();
    for (const id of ['a', 'b', 'c', 'd']) g.addNode(node(id));
    g.addEdge(edge('a', 'b'));
    g.addEdge(edge('b', 'c'));
    g.addEdge(edge('a', 'd'));
    g.addEdge(edge('d', 'c'));
    expect(g.pathBetween('a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('pathBetween returns single-node path for identical endpoints', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    expect(g.pathBetween('a', 'a')).toEqual(['a']);
  });

  it('pathBetween returns null when unreachable', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('b'));
    expect(g.pathBetween('a', 'b')).toBeNull();
  });

  it('respects direction in pathBetween', () => {
    const g = new CodeGraph();
    g.addNode(node('a'));
    g.addNode(node('b'));
    g.addEdge(edge('a', 'b'));
    expect(g.pathBetween('b', 'a')).toBeNull();
  });
});

describe('CodeGraph.buildFromJson', () => {
  it('validates and applies the full pipeline', () => {
    const g = CodeGraph.buildFromJson({
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b'), edge('a', 'missing')],
    });
    expect(g.order).toBe(2);
    expect(g.size).toBe(1);
  });

  it('round-trips through toJson', () => {
    const g = CodeGraph.buildFromJson({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const json = g.toJson();
    expect(json.nodes).toHaveLength(2);
    expect(json.edges).toHaveLength(1);
    expect(json.edges[0]?.source).toBe('a');
  });

  it('rejects malformed input via Zod', () => {
    expect(() => CodeGraph.buildFromJson({ nodes: [{ id: 'a' }], edges: [] })).toThrow();
  });
});

describe('languageFamilyOf', () => {
  it('derives from extension', () => {
    expect(languageFamilyOf(node('a', { source_file: 'x.ts' }))).toBe('ts');
    expect(languageFamilyOf(node('a', { source_file: 'x.py' }))).toBe('python');
  });

  it('treats js and ts as one family', () => {
    expect(languageFamilyOf(node('a', { source_file: 'x.js' }))).toBe(
      languageFamilyOf(node('a', { source_file: 'x.ts' })),
    );
  });
});
