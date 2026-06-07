import { describe, expect, it } from 'vitest';
import {
  type ExtractNode,
  calleeFromCall,
  extractFromTree,
  importsFromNode,
  isCallNode,
  isImportNode,
  makeSymbolId,
  moduleStem,
  symbolKindForNode,
} from './symbol-extraction';

// ---------------------------------------------------------------------------
// Synthetic tree-sitter node builder
//
// The chunker tests only exercise tree-sitter fallback paths (no language
// grammar wasm is available in this repo), so we test the extraction logic the
// same way: against synthetic `ExtractNode` trees. Node text is carried by
// `startIndex`/`endIndex` into a shared `source` string, exactly as a real
// tree-sitter node would expose it.
// ---------------------------------------------------------------------------

type Spec = {
  type: string;
  text?: string;
  fields?: Record<string, Spec>;
  children?: Spec[];
  startRow?: number;
  endRow?: number;
};

function buildTree(spec: Spec): { root: ExtractNode; source: string } {
  let source = '';

  const build = (s: Spec): ExtractNode => {
    const startIndex = source.length;
    if (s.text !== undefined) source += s.text;

    const fieldNodes: Record<string, ExtractNode> = {};
    const children: ExtractNode[] = [];

    if (s.fields) {
      for (const [name, childSpec] of Object.entries(s.fields)) {
        const childNode = build(childSpec);
        fieldNodes[name] = childNode;
        children.push(childNode);
      }
    }
    if (s.children) {
      for (const childSpec of s.children) {
        children.push(build(childSpec));
      }
    }

    const endIndex = source.length;
    const node: ExtractNode = {
      type: s.type,
      startIndex,
      endIndex,
      startPosition: { row: s.startRow ?? 0 },
      endPosition: { row: s.endRow ?? 0 },
      childCount: children.length,
      child: (i: number) => children[i] ?? null,
      childForFieldName: (name: string) => fieldNodes[name] ?? null,
    };
    return node;
  };

  const root = build(spec);
  return { root, source };
}

describe('moduleStem', () => {
  it('returns the last path segment without extension', () => {
    expect(moduleStem('./foo/bar.ts')).toBe('bar');
    expect(moduleStem('../a/b/c.js')).toBe('c');
    expect(moduleStem('utils')).toBe('utils');
    expect(moduleStem('@scope/pkg')).toBe('pkg');
  });

  it('strips surrounding quotes and trims', () => {
    expect(moduleStem("'./x/y.tsx'")).toBe('y');
    expect(moduleStem('"react"')).toBe('react');
  });

  it('handles windows separators and query/hash suffixes', () => {
    expect(moduleStem('a\\b\\c.py')).toBe('c');
    expect(moduleStem('./style.css?inline')).toBe('style');
  });

  it('keeps dotfiles intact', () => {
    expect(moduleStem('./.env')).toBe('.env');
  });
});

describe('makeSymbolId', () => {
  it('builds a file-scoped dotted id', () => {
    expect(makeSymbolId('src/a.ts', ['Foo', 'bar'])).toBe('src/a.ts::Foo.bar');
    expect(makeSymbolId('src/a.ts', ['top'])).toBe('src/a.ts::top');
  });
});

describe('node-type classifiers', () => {
  it('maps symbol node types to kinds', () => {
    expect(symbolKindForNode('function_declaration')).toBe('function');
    expect(symbolKindForNode('class_declaration')).toBe('class');
    expect(symbolKindForNode('method_definition')).toBe('method');
    expect(symbolKindForNode('struct_item')).toBe('struct');
    expect(symbolKindForNode('interface_declaration')).toBe('interface');
    expect(symbolKindForNode('enum_specifier')).toBe('enum');
    expect(symbolKindForNode('expression_statement')).toBeUndefined();
  });

  it('recognises call and import node types', () => {
    expect(isCallNode('call_expression')).toBe(true);
    expect(isCallNode('method_invocation')).toBe(true);
    expect(isCallNode('binary_expression')).toBe(false);
    expect(isImportNode('import_statement')).toBe(true);
    expect(isImportNode('import_from_statement')).toBe(true);
    expect(isImportNode('expression_statement')).toBe(false);
  });
});

describe('calleeFromCall', () => {
  it('reads a plain function call as a non-member call', () => {
    const { root, source } = buildTree({
      type: 'call_expression',
      fields: { function: { type: 'identifier', text: 'doThing' } },
      children: [{ type: 'arguments', text: '()' }],
    });
    expect(calleeFromCall(root, source)).toEqual({ calleeLabel: 'doThing', isMemberCall: false });
  });

  it('reads a member call as a member call with the rightmost name', () => {
    const { root, source } = buildTree({
      type: 'call_expression',
      fields: {
        function: {
          type: 'member_expression',
          fields: {
            object: { type: 'identifier', text: 'a' },
            property: { type: 'property_identifier', text: 'b' },
          },
        },
      },
      children: [{ type: 'arguments', text: '()' }],
    });
    expect(calleeFromCall(root, source)).toEqual({ calleeLabel: 'b', isMemberCall: true });
  });

  it('falls back to first non-arg child when there is no function field', () => {
    const { root, source } = buildTree({
      type: 'call',
      children: [
        { type: 'identifier', text: 'helper' },
        { type: 'argument_list', text: '()' },
      ],
    });
    expect(calleeFromCall(root, source)).toEqual({ calleeLabel: 'helper', isMemberCall: false });
  });
});

describe('importsFromNode', () => {
  it('parses a named TS import with an alias', () => {
    const { root, source } = buildTree({
      type: 'import_declaration',
      children: [
        {
          type: 'import_clause',
          children: [
            {
              type: 'named_imports',
              children: [
                { type: 'import_specifier', fields: { name: { type: 'identifier', text: 'a' } } },
                {
                  type: 'import_specifier',
                  fields: {
                    name: { type: 'identifier', text: 'b' },
                    alias: { type: 'identifier', text: 'c' },
                  },
                },
              ],
            },
          ],
        },
        { type: 'string', text: "'./mod.ts'" },
      ],
    });
    expect(importsFromNode(root, source, 'f.ts')).toEqual([
      { moduleStem: 'mod', symbol: 'a', sourceFile: 'f.ts' },
      { moduleStem: 'mod', symbol: 'b', alias: 'c', sourceFile: 'f.ts' },
    ]);
  });

  it('parses a namespace import', () => {
    const { root, source } = buildTree({
      type: 'import_statement',
      children: [
        {
          type: 'import_clause',
          children: [{ type: 'namespace_import', children: [{ type: 'identifier', text: 'ns' }] }],
        },
        { type: 'string', text: "'lib/util.js'" },
      ],
    });
    expect(importsFromNode(root, source, 'f.ts')).toEqual([
      { moduleStem: 'util', symbol: '*', alias: 'ns', sourceFile: 'f.ts' },
    ]);
  });

  it('parses a python from-import with alias and wildcard', () => {
    const { root, source } = buildTree({
      type: 'import_from_statement',
      fields: { module_name: { type: 'dotted_name', text: 'pkg.sub' } },
      children: [
        { type: 'identifier', text: 'thing' },
        {
          type: 'aliased_import',
          fields: {
            name: { type: 'identifier', text: 'other' },
            alias: { type: 'identifier', text: 'o' },
          },
        },
      ],
    });
    expect(importsFromNode(root, source, 'm.py')).toEqual([
      { moduleStem: 'sub', symbol: 'thing', sourceFile: 'm.py' },
      { moduleStem: 'sub', symbol: 'other', alias: 'o', sourceFile: 'm.py' },
    ]);
  });

  it('parses a python plain import', () => {
    const { root, source } = buildTree({
      type: 'import_statement',
      children: [{ type: 'dotted_name', text: 'os.path' }],
    });
    expect(importsFromNode(root, source, 'm.py')).toEqual([
      { moduleStem: 'path', symbol: 'os.path', sourceFile: 'm.py' },
    ]);
  });
});

describe('extractFromTree', () => {
  it('extracts a class, its method, a method call, and parent links', () => {
    const { root, source } = buildTree({
      type: 'program',
      children: [
        {
          type: 'class_declaration',
          startRow: 0,
          endRow: 6,
          fields: { name: { type: 'type_identifier', text: 'Widget' } },
          children: [
            {
              type: 'class_body',
              children: [
                {
                  type: 'method_definition',
                  startRow: 1,
                  endRow: 5,
                  fields: { name: { type: 'property_identifier', text: 'render' } },
                  children: [
                    {
                      type: 'statement_block',
                      children: [
                        {
                          type: 'call_expression',
                          startRow: 2,
                          endRow: 2,
                          fields: {
                            function: {
                              type: 'member_expression',
                              fields: {
                                object: { type: 'identifier', text: 'this' },
                                property: { type: 'property_identifier', text: 'paint' },
                              },
                            },
                          },
                          children: [{ type: 'arguments', text: '()' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = extractFromTree(root, {
      source,
      language: 'typescript',
      filePath: 'src/w.ts',
    });

    expect(result.symbols).toHaveLength(2);
    const cls = result.symbols.find((s) => s.kind === 'class');
    const method = result.symbols.find((s) => s.kind === 'method');
    expect(cls).toMatchObject({
      id: 'src/w.ts::Widget',
      label: 'Widget',
      kind: 'class',
      sourceFile: 'src/w.ts',
      language: 'typescript',
      location: { startLine: 1, endLine: 7 },
    });
    expect(cls?.parentId).toBeUndefined();
    expect(method).toMatchObject({
      id: 'src/w.ts::Widget.render',
      kind: 'method',
      parentId: 'src/w.ts::Widget',
      location: { startLine: 2, endLine: 6 },
    });

    expect(result.calls).toEqual([
      {
        callerId: 'src/w.ts::Widget.render',
        calleeLabel: 'paint',
        isMemberCall: true,
        sourceFile: 'src/w.ts',
        location: { startLine: 3, endLine: 3 },
      },
    ]);
  });

  it('reclassifies a function nested in a class as a method (python-style)', () => {
    const { root, source } = buildTree({
      type: 'module',
      children: [
        {
          type: 'class_definition',
          fields: { name: { type: 'identifier', text: 'Animal' } },
          children: [
            {
              type: 'block',
              children: [
                {
                  type: 'function_definition',
                  fields: { name: { type: 'identifier', text: 'speak' } },
                },
              ],
            },
          ],
        },
      ],
    });
    const result = extractFromTree(root, { source, language: 'python', filePath: 'a.py' });
    const speak = result.symbols.find((s) => s.label === 'speak');
    expect(speak?.kind).toBe('method');
    expect(speak?.parentId).toBe('a.py::Animal');
  });

  it('ignores calls outside any enclosing symbol', () => {
    const { root, source } = buildTree({
      type: 'program',
      children: [
        {
          type: 'call_expression',
          fields: { function: { type: 'identifier', text: 'topLevel' } },
          children: [{ type: 'arguments', text: '()' }],
        },
      ],
    });
    const result = extractFromTree(root, { source, language: 'typescript', filePath: 'a.ts' });
    expect(result.calls).toEqual([]);
    expect(result.symbols).toEqual([]);
  });

  it('collects imports and a top-level function together', () => {
    const { root, source } = buildTree({
      type: 'program',
      children: [
        {
          type: 'import_declaration',
          children: [
            {
              type: 'import_clause',
              children: [
                {
                  type: 'named_imports',
                  children: [
                    {
                      type: 'import_specifier',
                      fields: { name: { type: 'identifier', text: 'readFile' } },
                    },
                  ],
                },
              ],
            },
            { type: 'string', text: "'node:fs'" },
          ],
        },
        {
          type: 'function_declaration',
          startRow: 1,
          endRow: 3,
          fields: { name: { type: 'identifier', text: 'main' } },
          children: [
            {
              type: 'statement_block',
              children: [
                {
                  type: 'call_expression',
                  startRow: 2,
                  endRow: 2,
                  fields: { function: { type: 'identifier', text: 'readFile' } },
                  children: [{ type: 'arguments', text: '()' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const result = extractFromTree(root, { source, language: 'typescript', filePath: 'm.ts' });
    expect(result.imports).toEqual([{ moduleStem: 'fs', symbol: 'readFile', sourceFile: 'm.ts' }]);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]?.kind).toBe('function');
    expect(result.calls).toEqual([
      {
        callerId: 'm.ts::main',
        calleeLabel: 'readFile',
        isMemberCall: false,
        sourceFile: 'm.ts',
        location: { startLine: 3, endLine: 3 },
      },
    ]);
  });
});
