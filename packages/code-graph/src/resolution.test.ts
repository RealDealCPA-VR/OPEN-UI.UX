import { describe, expect, it } from 'vitest';
import { CodeGraph } from './graph';
import { resolveCalls } from './resolution';
import type { GraphEdge, GraphNode } from './schema';
import type { RawCall, RawImport, RawSymbol } from './extract';

function symbol(over: Partial<RawSymbol> & Pick<RawSymbol, 'id'>): RawSymbol {
  return {
    label: over.id,
    kind: 'function',
    sourceFile: 'src/a.ts',
    language: 'ts',
    location: { startLine: 1, endLine: 2 },
    ...over,
  };
}

function call(over: Partial<RawCall> & Pick<RawCall, 'callerId' | 'calleeLabel'>): RawCall {
  return {
    isMemberCall: false,
    sourceFile: 'src/a.ts',
    location: { startLine: 5, endLine: 5 },
    ...over,
  };
}

function seed(symbols: RawSymbol[]): CodeGraph {
  const g = new CodeGraph();
  for (const s of symbols) {
    const node: GraphNode = {
      id: s.id,
      label: s.label,
      file_type: 'code',
      source_file: s.sourceFile,
      metadata: { language: s.language, kind: s.kind },
    };
    g.addNode(node);
  }
  return g;
}

function callEdges(g: CodeGraph): GraphEdge[] {
  const out: GraphEdge[] = [];
  g.forEachEdge((e) => {
    if (e.relation === 'calls') out.push(e);
  });
  return out;
}

describe('resolveCalls import-guided', () => {
  it('adds an EXTRACTED edge for a unique import match', () => {
    const symbols = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const imports: RawImport[] = [
      { moduleStem: './util', symbol: 'helper', sourceFile: 'src/main.ts' },
    ];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports });

    const edges = callEdges(g);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe('main::run');
    expect(edges[0]?.target).toBe('util::helper');
    expect(edges[0]?.confidence).toBe('EXTRACTED');
  });

  it('resolves via the import alias as the local binding', () => {
    const symbols = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const imports: RawImport[] = [
      { moduleStem: './util', symbol: 'helper', alias: 'h', sourceFile: 'src/main.ts' },
    ];
    const calls = [call({ callerId: 'main::run', calleeLabel: 'h', sourceFile: 'src/main.ts' })];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports });

    expect(callEdges(g)[0]?.target).toBe('util::helper');
  });

  it('skips an import whose (module, symbol) maps to more than one definition', () => {
    const symbols = [
      symbol({ id: 'util_a::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'util_b::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const imports: RawImport[] = [
      { moduleStem: './util', symbol: 'helper', sourceFile: 'src/main.ts' },
    ];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports });

    expect(callEdges(g)).toHaveLength(0);
  });
});

describe('resolveCalls label-index fallback', () => {
  it('adds an INFERRED edge for a unique global label', () => {
    const symbols = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports: [] });

    const edges = callEdges(g);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.target).toBe('util::helper');
    expect(edges[0]?.confidence).toBe('INFERRED');
  });

  it('skips an ambiguous global label', () => {
    const symbols = [
      symbol({ id: 'a::helper', label: 'helper', sourceFile: 'src/a.ts' }),
      symbol({ id: 'b::helper', label: 'helper', sourceFile: 'src/b.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports: [] });

    expect(callEdges(g)).toHaveLength(0);
  });
});

describe('resolveCalls skips and non-throwing behavior', () => {
  it('skips member calls', () => {
    const symbols = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const calls = [
      call({
        callerId: 'main::run',
        calleeLabel: 'helper',
        isMemberCall: true,
        sourceFile: 'src/main.ts',
      }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports: [] });

    expect(callEdges(g)).toHaveLength(0);
  });

  it('adds no edge and does not throw for an unresolved callee', () => {
    const symbols = [symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' })];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'doesNotExist', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    expect(() => resolveCalls(g, { symbols, calls, imports: [] })).not.toThrow();
    expect(callEdges(g)).toHaveLength(0);
  });

  it('prefers the EXTRACTED import-guided edge over a label fallback', () => {
    const symbols = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const imports: RawImport[] = [
      { moduleStem: './util', symbol: 'helper', sourceFile: 'src/main.ts' },
    ];
    const calls = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = seed(symbols);
    resolveCalls(g, { symbols, calls, imports });

    const edges = callEdges(g);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.confidence).toBe('EXTRACTED');
  });
});
