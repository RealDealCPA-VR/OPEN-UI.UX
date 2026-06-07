/**
 * Symbol/edge/import extraction over the SAME tree-sitter parse that
 * `chunkBySymbols` already performs. This produces a structural graph view of a
 * file — symbols (with parent links), raw call sites, and parseable imports —
 * for downstream consumers such as a code-graph builder.
 *
 * The result is intentionally a STRUCTURAL twin of the `ExtractionResult`
 * contract owned by `@opencodex/code-graph`. We declare the types locally and
 * never import that package: code-graph already depends (conceptually) on the
 * chunker's output shape, so importing it here would create a dependency cycle.
 */

export type SymbolKind = 'function' | 'class' | 'method' | 'struct' | 'interface' | 'enum';

export type SourceLocation = {
  startLine: number;
  endLine: number;
};

export type RawSymbol = {
  id: string;
  label: string;
  kind: SymbolKind;
  sourceFile: string;
  language: string;
  location: SourceLocation;
  parentId?: string;
};

export type RawCall = {
  callerId: string;
  calleeLabel: string;
  isMemberCall: boolean;
  sourceFile: string;
  location: SourceLocation;
};

export type RawImport = {
  moduleStem: string;
  symbol: string;
  alias?: string;
  sourceFile: string;
};

export type ExtractionResult = {
  symbols: RawSymbol[];
  calls: RawCall[];
  imports: RawImport[];
};

/**
 * Minimal structural view of a tree-sitter node. Mirrors the shape used by the
 * chunker's walk; declared here so the pure helpers are testable with synthetic
 * nodes without a loaded grammar.
 */
export type ExtractNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number };
  endPosition: { row: number };
  childCount: number;
  child(i: number): ExtractNode | null;
  childForFieldName?: (name: string) => ExtractNode | null;
};

/**
 * Tree-sitter node types that map onto a `SymbolKind`. The same node type can
 * mean different things across grammars, so we resolve `method` vs `function`
 * by enclosing context (see `resolveKind`) rather than by type alone.
 */
const SYMBOL_KIND_BY_NODE_TYPE: ReadonlyMap<string, SymbolKind> = new Map([
  ['function_declaration', 'function'],
  ['function_definition', 'function'],
  ['function_item', 'function'],
  ['arrow_function', 'function'],
  ['method_declaration', 'method'],
  ['method_definition', 'method'],
  ['class_declaration', 'class'],
  ['class_definition', 'class'],
  ['class_specifier', 'class'],
  ['impl_item', 'class'],
  ['trait_item', 'interface'],
  ['interface_declaration', 'interface'],
  ['struct_specifier', 'struct'],
  ['struct_item', 'struct'],
  ['enum_declaration', 'enum'],
  ['enum_specifier', 'enum'],
  ['enum_item', 'enum'],
]);

/** Node types whose children may host class methods. */
const CLASS_LIKE_KINDS: ReadonlySet<SymbolKind> = new Set(['class', 'struct', 'interface']);

/** Call-expression node types across the grammars we support. */
const CALL_NODE_TYPES: ReadonlySet<string> = new Set([
  'call_expression',
  'call',
  'method_invocation',
  'function_call_expression',
  'invocation_expression',
]);

/** Import-statement node types per language (best-effort: TS/JS/Python). */
const IMPORT_NODE_TYPES: ReadonlySet<string> = new Set([
  'import_statement',
  'import_from_statement',
  'import_declaration',
]);

export function symbolKindForNode(nodeType: string): SymbolKind | undefined {
  return SYMBOL_KIND_BY_NODE_TYPE.get(nodeType);
}

export function isCallNode(nodeType: string): boolean {
  return CALL_NODE_TYPES.has(nodeType);
}

export function isImportNode(nodeType: string): boolean {
  return IMPORT_NODE_TYPES.has(nodeType);
}

/**
 * Build a stable, file-scoped symbol id: `${filePath}::${symbolPath}` where
 * `symbolPath` is the dotted chain of enclosing symbol names. Anonymous symbols
 * (e.g. an arrow function assigned nowhere we can name) fall back to a
 * positional token so ids stay unique within a file.
 */
export function makeSymbolId(filePath: string, symbolPath: readonly string[]): string {
  return `${filePath}::${symbolPath.join('.')}`;
}

/**
 * `last path segment of the module specifier without extension`, for path-style
 * (JS/TS) specifiers. Strips quotes, a `?query`/`#hash` suffix, and a leading
 * URL/protocol scheme like `node:` (so `node:fs` -> `fs`). Splits on `/` and
 * `\`. The trailing file extension is removed, but a leading-dot file such as
 * `.env` is kept intact.
 */
export function moduleStem(specifier: string): string {
  const cleaned = specifier.replace(/['"]/g, '').trim();
  const noQuery = cleaned.split(/[?#]/)[0] ?? cleaned;
  // Strip a leading `scheme:` (node:, npm:, https:) when it isn't a Windows
  // drive letter and there is no slash splitting it off already.
  const schemeStripped = noQuery.replace(/^[a-z][a-z0-9+.-]*:(?![\\/])/i, '');
  const segments = schemeStripped.split(/[\\/]/).filter((s) => s.length > 0);
  const last = segments.length > 0 ? segments[segments.length - 1] : schemeStripped;
  const base = last ?? schemeStripped;
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(0, dot);
  return base;
}

/**
 * Stem for a Python module specifier, where `.` is the package separator (not a
 * file extension): the last dotted segment. `os.path` -> `path`, `pkg` -> `pkg`.
 */
function pythonModuleStem(specifier: string): string {
  const cleaned = specifier.trim();
  if (cleaned.length === 0) return cleaned;
  const segments = cleaned.split('.').filter((s) => s.length > 0);
  const last = segments.length > 0 ? segments[segments.length - 1] : cleaned;
  return last ?? cleaned;
}

function nodeText(node: ExtractNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function symbolName(node: ExtractNode, source: string): string | undefined {
  const named = node.childForFieldName?.('name');
  if (named) return nodeText(named, source);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && (c.type === 'identifier' || c.type === 'type_identifier')) {
      return nodeText(c, source);
    }
  }
  return undefined;
}

/**
 * The label printed on a call site: the rightmost identifier of the callee.
 * For `a.b.c()` this is `c`; for `foo()` it is `foo`. Returns `isMemberCall`
 * true when the callee is a member/property access.
 */
export function calleeFromCall(
  callNode: ExtractNode,
  source: string,
): { calleeLabel: string; isMemberCall: boolean } | undefined {
  const fn =
    callNode.childForFieldName?.('function') ??
    callNode.childForFieldName?.('name') ??
    firstNonArgChild(callNode);
  if (!fn) return undefined;
  return calleeFromExpression(fn, source);
}

function firstNonArgChild(callNode: ExtractNode): ExtractNode | undefined {
  for (let i = 0; i < callNode.childCount; i++) {
    const c = callNode.child(i);
    if (!c) continue;
    if (c.type === 'arguments' || c.type === 'argument_list') continue;
    return c;
  }
  return undefined;
}

function calleeFromExpression(
  node: ExtractNode,
  source: string,
): { calleeLabel: string; isMemberCall: boolean } | undefined {
  const memberTypes = new Set([
    'member_expression',
    'field_expression',
    'attribute',
    'scoped_identifier',
    'field_access',
    'selector_expression',
    'navigation_expression',
  ]);
  if (memberTypes.has(node.type)) {
    const prop =
      node.childForFieldName?.('property') ??
      node.childForFieldName?.('field') ??
      node.childForFieldName?.('name') ??
      node.childForFieldName?.('attribute') ??
      lastIdentifierChild(node);
    const label = prop ? nodeText(prop, source) : nodeText(node, source);
    return { calleeLabel: label, isMemberCall: true };
  }
  return { calleeLabel: nodeText(node, source), isMemberCall: false };
}

function lastIdentifierChild(node: ExtractNode): ExtractNode | undefined {
  let found: ExtractNode | undefined;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (
      c &&
      (c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'type_identifier')
    ) {
      found = c;
    }
  }
  return found;
}

/**
 * Parse a single import statement node into zero or more `RawImport` rows.
 * Best-effort and tuned for TS/JS/Python grammars:
 *   - `import { a, b as c } from 'm'`  -> a, b(alias c)
 *   - `import d from 'm'`              -> default (alias d)
 *   - `import * as ns from 'm'`        -> * (alias ns)
 *   - `import 'm'`                     -> (side-effect; symbol '')
 *   - `from m import a, b as c`        -> a, b(alias c)
 *   - `import m` / `import m as n`     -> (module; alias n)
 */
export function importsFromNode(
  node: ExtractNode,
  source: string,
  sourceFile: string,
): RawImport[] {
  if (node.type === 'import_from_statement') {
    return pythonFromImport(node, source, sourceFile);
  }
  if (node.type === 'import_statement') {
    // Disambiguate JS/TS (`import ... from '...'`) from Python (`import a, b`):
    // only JS imports carry a string-literal module specifier.
    if (findModuleSpecifier(node, source) !== undefined) {
      return jsImport(node, source, sourceFile);
    }
    return pythonPlainImport(node, source, sourceFile);
  }
  if (node.type === 'import_declaration') {
    return jsImport(node, source, sourceFile);
  }
  return [];
}

function findModuleSpecifier(node: ExtractNode, source: string): string | undefined {
  const direct = node.childForFieldName?.('source') ?? node.childForFieldName?.('module_name');
  if (direct) return nodeText(direct, source);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && (c.type === 'string' || c.type === 'string_literal')) {
      return nodeText(c, source);
    }
  }
  return undefined;
}

function jsImport(node: ExtractNode, source: string, sourceFile: string): RawImport[] {
  const specifier = findModuleSpecifier(node, source);
  if (specifier === undefined) return [];
  const stem = moduleStem(specifier);
  const out: RawImport[] = [];

  const collect = (n: ExtractNode): void => {
    if (n.type === 'import_specifier') {
      const nameNode = n.childForFieldName?.('name') ?? firstIdentifier(n);
      const aliasNode = n.childForFieldName?.('alias');
      const symbol = nameNode ? nodeText(nameNode, source) : '';
      const alias = aliasNode ? nodeText(aliasNode, source) : undefined;
      out.push(
        alias
          ? { moduleStem: stem, symbol, alias, sourceFile }
          : { moduleStem: stem, symbol, sourceFile },
      );
      return;
    }
    if (n.type === 'namespace_import') {
      const id = firstIdentifier(n);
      out.push({
        moduleStem: stem,
        symbol: '*',
        alias: id ? nodeText(id, source) : undefined,
        sourceFile,
      });
      return;
    }
    if (n.type === 'identifier') {
      // A bare identifier directly under the import clause is a default import.
      out.push({ moduleStem: stem, symbol: 'default', alias: nodeText(n, source), sourceFile });
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) collect(c);
    }
  };

  const clause = findChildOfType(node, 'import_clause') ?? node;
  for (let i = 0; i < clause.childCount; i++) {
    const c = clause.child(i);
    if (c) collect(c);
  }

  if (out.length === 0) {
    out.push({ moduleStem: stem, symbol: '', sourceFile });
  }
  return out;
}

function pythonFromImport(node: ExtractNode, source: string, sourceFile: string): RawImport[] {
  const moduleNode = node.childForFieldName?.('module_name');
  const specifier = moduleNode ? nodeText(moduleNode, source) : '';
  const stem = pythonModuleStem(specifier);
  const out: RawImport[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c === moduleNode) continue;
    if (c.type === 'dotted_name' || c.type === 'identifier') {
      out.push({ moduleStem: stem, symbol: nodeText(c, source), sourceFile });
    } else if (c.type === 'aliased_import') {
      const nameNode =
        c.childForFieldName?.('name') ?? firstChildOfTypes(c, ['dotted_name', 'identifier']);
      const aliasNode = c.childForFieldName?.('alias');
      const symbol = nameNode ? nodeText(nameNode, source) : '';
      const alias = aliasNode ? nodeText(aliasNode, source) : undefined;
      out.push(
        alias
          ? { moduleStem: stem, symbol, alias, sourceFile }
          : { moduleStem: stem, symbol, sourceFile },
      );
    } else if (c.type === 'wildcard_import') {
      out.push({ moduleStem: stem, symbol: '*', sourceFile });
    }
  }
  return out;
}

function pythonPlainImport(node: ExtractNode, source: string, sourceFile: string): RawImport[] {
  const out: RawImport[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'dotted_name') {
      const spec = nodeText(c, source);
      out.push({ moduleStem: pythonModuleStem(spec), symbol: spec, sourceFile });
    } else if (c.type === 'aliased_import') {
      const nameNode =
        c.childForFieldName?.('name') ?? firstChildOfTypes(c, ['dotted_name', 'identifier']);
      const aliasNode = c.childForFieldName?.('alias');
      const spec = nameNode ? nodeText(nameNode, source) : '';
      const alias = aliasNode ? nodeText(aliasNode, source) : undefined;
      out.push(
        alias
          ? { moduleStem: pythonModuleStem(spec), symbol: spec, alias, sourceFile }
          : { moduleStem: pythonModuleStem(spec), symbol: spec, sourceFile },
      );
    }
  }
  return out;
}

function firstIdentifier(node: ExtractNode): ExtractNode | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === 'identifier') return c;
  }
  return undefined;
}

function firstChildOfTypes(node: ExtractNode, types: readonly string[]): ExtractNode | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return undefined;
}

function findChildOfType(node: ExtractNode, type: string): ExtractNode | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return undefined;
}

/** 1-based start/end line for a node, from its tree-sitter positions. */
function locationOf(node: ExtractNode): SourceLocation {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

type WalkContext = {
  filePath: string;
  language: string;
  source: string;
  symbols: RawSymbol[];
  calls: RawCall[];
  imports: RawImport[];
  anonCounter: { n: number };
};

/**
 * A symbol nested inside a class-like symbol is a `method`, regardless of how
 * the grammar typed the node (e.g. Python uses `function_definition` for both).
 */
function resolveKind(rawKind: SymbolKind, parentKind: SymbolKind | undefined): SymbolKind {
  if (rawKind === 'function' && parentKind !== undefined && CLASS_LIKE_KINDS.has(parentKind)) {
    return 'method';
  }
  return rawKind;
}

/**
 * Recursive walk. `enclosing` is the nearest enclosing symbol (its id is the
 * caller for calls, the parentId for nested symbols), and `pathParts` is the
 * dotted name chain used to build the next symbol id.
 */
function walk(
  node: ExtractNode,
  ctx: WalkContext,
  enclosing: { id: string; kind: SymbolKind } | undefined,
  pathParts: readonly string[],
): void {
  const rawKind = symbolKindForNode(node.type);

  if (rawKind !== undefined) {
    const kind = resolveKind(rawKind, enclosing?.kind);
    const name = symbolName(node, ctx.source) ?? `<anonymous:${node.type}#${ctx.anonCounter.n++}>`;
    const nextPath = [...pathParts, name];
    const id = makeSymbolId(ctx.filePath, nextPath);
    const symbol: RawSymbol = {
      id,
      label: name,
      kind,
      sourceFile: ctx.filePath,
      language: ctx.language,
      location: locationOf(node),
    };
    if (enclosing) symbol.parentId = enclosing.id;
    ctx.symbols.push(symbol);

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) walk(c, ctx, { id, kind }, nextPath);
    }
    return;
  }

  if (isCallNode(node.type)) {
    const callee = calleeFromCall(node, ctx.source);
    if (callee && enclosing) {
      ctx.calls.push({
        callerId: enclosing.id,
        calleeLabel: callee.calleeLabel,
        isMemberCall: callee.isMemberCall,
        sourceFile: ctx.filePath,
        location: locationOf(node),
      });
    }
    // Continue walking so nested calls in arguments are also captured.
  }

  if (isImportNode(node.type)) {
    ctx.imports.push(...importsFromNode(node, ctx.source, ctx.filePath));
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walk(c, ctx, enclosing, pathParts);
  }
}

/**
 * Run the full extraction walk over an already-parsed tree root. Exposed
 * separately from the grammar-loading wrapper so it is unit-testable against
 * synthetic `ExtractNode` trees without a registered grammar.
 */
export function extractFromTree(
  root: ExtractNode,
  opts: { source: string; language: string; filePath: string },
): ExtractionResult {
  const ctx: WalkContext = {
    filePath: opts.filePath,
    language: opts.language,
    source: opts.source,
    symbols: [],
    calls: [],
    imports: [],
    anonCounter: { n: 0 },
  };
  walk(root, ctx, undefined, []);
  return { symbols: ctx.symbols, calls: ctx.calls, imports: ctx.imports };
}
