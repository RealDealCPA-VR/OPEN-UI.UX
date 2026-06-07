import { describe, expect, it } from 'vitest';
import { buildGraphFromExtraction } from './extract';
import type { ExtractionResult, RawCall, RawImport, RawSymbol } from './extract';

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

function result(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return { symbols: [], calls: [], imports: [], ...over };
}

function relationBetween(
  g: ReturnType<typeof buildGraphFromExtraction>,
  source: string,
  target: string,
): string | undefined {
  let found: string | undefined;
  g.forEachEdge((e) => {
    if (e.source === source && e.target === target) found = e.relation;
  });
  return found;
}

describe('buildGraphFromExtraction nodes', () => {
  it('adds one code node per symbol with language and kind metadata', () => {
    const g = buildGraphFromExtraction(
      result({ symbols: [symbol({ id: 'a', language: 'python', kind: 'class' })] }),
    );
    const node = g.getNode('a');
    expect(node?.file_type).toBe('code');
    expect(node?.metadata?.['language']).toBe('python');
    expect(node?.metadata?.['kind']).toBe('class');
  });

  it('rejects malformed extraction via Zod', () => {
    expect(() =>
      buildGraphFromExtraction({ symbols: [{ id: 'a' }], calls: [], imports: [] } as never),
    ).toThrow();
  });

  it('rejects unknown extra keys via .strict()', () => {
    const bad = result({ symbols: [symbol({ id: 'a' })] }) as unknown as Record<string, unknown>;
    bad['extra'] = true;
    expect(() => buildGraphFromExtraction(bad as never)).toThrow();
  });
});

describe('buildGraphFromExtraction containment edges', () => {
  it('emits a contains edge for a non-method child', () => {
    const g = buildGraphFromExtraction(
      result({
        symbols: [
          symbol({ id: 'mod', kind: 'class' }),
          symbol({ id: 'mod::field', kind: 'function', parentId: 'mod' }),
        ],
      }),
    );
    expect(relationBetween(g, 'mod', 'mod::field')).toBe('contains');
  });

  it('emits a method edge for a method child', () => {
    const g = buildGraphFromExtraction(
      result({
        symbols: [
          symbol({ id: 'C', kind: 'class' }),
          symbol({ id: 'C::m', kind: 'method', parentId: 'C' }),
        ],
      }),
    );
    expect(relationBetween(g, 'C', 'C::m')).toBe('method');
  });

  it('drops a containment edge to a missing parent', () => {
    const g = buildGraphFromExtraction(
      result({ symbols: [symbol({ id: 'child', parentId: 'ghost' })] }),
    );
    expect(g.size).toBe(0);
  });
});

describe('buildGraphFromExtraction end-to-end', () => {
  it('resolves an import-guided cross-file call into a small project graph', () => {
    const symbols: RawSymbol[] = [
      symbol({ id: 'util::helper', label: 'helper', sourceFile: 'src/util.ts' }),
      symbol({ id: 'main::run', label: 'run', sourceFile: 'src/main.ts' }),
    ];
    const imports: RawImport[] = [
      { moduleStem: './util', symbol: 'helper', sourceFile: 'src/main.ts' },
    ];
    const calls: RawCall[] = [
      call({ callerId: 'main::run', calleeLabel: 'helper', sourceFile: 'src/main.ts' }),
    ];

    const g = buildGraphFromExtraction(result({ symbols, calls, imports }));

    expect(g.order).toBe(2);
    expect(relationBetween(g, 'main::run', 'util::helper')).toBe('calls');
    g.forEachEdge((e) => {
      if (e.source === 'main::run' && e.target === 'util::helper') {
        expect(e.confidence).toBe('EXTRACTED');
      }
    });
  });
});
