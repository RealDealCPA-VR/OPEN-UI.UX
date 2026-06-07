/**
 * @opencodex/rag-chunker
 *
 * Two chunking strategies for source code:
 *
 *   1. `chunkBySize` — pure size-based line splitter with overlap. Works on any
 *      language and has zero runtime deps.
 *
 *   2. `chunkBySymbols` — AST-aware splitter built on `web-tree-sitter`. Walks
 *      the parse tree and breaks the file at top-level function / class /
 *      method boundaries, falling back to `chunkBySize` for any chunk that is
 *      still larger than `maxChars`, and for any language whose grammar has
 *      not been registered. Grammars must be supplied by the host via
 *      `registerGrammar` (a `.wasm` file on disk or a fetched ArrayBuffer)
 *      — we deliberately do NOT bundle them into this package to keep its
 *      footprint small.
 */

export type Chunk = {
  content: string;
  startLine: number;
  endLine: number;
  symbolPath?: string;
};

/** Top ~15 languages we know how to AST-chunk if a grammar is registered. */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'go',
  'rust',
  'java',
  'cpp',
  'c',
  'ruby',
  'php',
  'csharp',
  'kotlin',
  'swift',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Split `text` into line-aligned chunks of at most `maxChars` characters,
 * with `overlapChars` of trailing context replicated at the head of the next
 * chunk (line-aligned, so we never split mid-line).
 *
 * Line numbers are 1-based and inclusive at both ends.
 */
function countLines(text: string): number {
  // Number of content lines. A single trailing newline terminates the last
  // line rather than introducing an empty one, so `'a\nb\n'` is 2 lines.
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  if (text[text.length - 1] === '\n') count--;
  return count;
}

export function chunkBySize(text: string, maxChars = 1500, overlapChars = 100): Chunk[] {
  if (maxChars <= 0) throw new Error('maxChars must be positive');
  if (overlapChars < 0) throw new Error('overlapChars must be non-negative');
  if (overlapChars >= maxChars) throw new Error('overlapChars must be smaller than maxChars');

  if (text.length === 0) return [];
  if (text.length <= maxChars) {
    return [{ content: text, startLine: 1, endLine: countLines(text) }];
  }

  const lines = text.split('\n');
  // A single trailing newline yields a phantom empty final element from split;
  // it terminates the last line rather than adding one, so it must not count.
  const lastContentLine = countLines(text);
  const chunks: Chunk[] = [];

  let i = 0;
  while (i < lines.length) {
    let size = 0;
    let j = i;
    while (j < lines.length) {
      // +1 accounts for the rejoining newline (except the first line).
      const lineCost = (lines[j] ?? '').length + (j === i ? 0 : 1);
      if (size + lineCost > maxChars && j > i) break;
      size += lineCost;
      j++;
    }

    const content = lines.slice(i, j).join('\n');
    chunks.push({ content, startLine: i + 1, endLine: Math.min(j, lastContentLine) });

    if (j >= lines.length) break;

    // Walk back from j to build an overlap window of ~overlapChars chars.
    let overlapStart = j;
    let overlapSize = 0;
    while (overlapStart > i + 1 && overlapSize < overlapChars) {
      overlapStart--;
      overlapSize += (lines[overlapStart] ?? '').length + 1;
    }
    i = overlapStart;
    if (i === j) i = j; // safety; loop terminates either way
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// AST-aware chunking via web-tree-sitter
// ---------------------------------------------------------------------------

// `web-tree-sitter` ships as a CommonJS module with `export = Parser`. When
// imported dynamically TS surfaces it as a synthetic ESM namespace, with the
// `Parser` class on `.default` and a merged namespace of static helpers
// (`Language`, `Query`, ...) on the top-level object. We model that loosely
// because the precise shape varies across `esModuleInterop` settings — what
// matters at runtime is calling the constructor and `.Language.load`.
type TreeSitterModule = {
  default: {
    new (): {
      setLanguage(lang: unknown): void;
      parse(input: string): { rootNode: unknown };
    };
    init(opts?: object): Promise<void>;
    Language: { load(input: string | Uint8Array): Promise<unknown> };
  };
};

let parserModulePromise: Promise<TreeSitterModule['default']> | null = null;
let parserInitPromise: Promise<void> | null = null;

async function loadParserModule(): Promise<TreeSitterModule['default']> {
  if (!parserModulePromise) {
    parserModulePromise = (import('web-tree-sitter') as unknown as Promise<TreeSitterModule>).then(
      (m) => m.default,
    );
  }
  return parserModulePromise;
}

async function ensureParserInitialized(): Promise<TreeSitterModule['default']> {
  const Parser = await loadParserModule();
  if (!parserInitPromise) parserInitPromise = Parser.init();
  await parserInitPromise;
  return Parser;
}

/** Source for a tree-sitter grammar — either a path to a .wasm file or its bytes. */
export type GrammarSource = string | Uint8Array;

const grammars = new Map<string, GrammarSource>();

/**
 * Register a tree-sitter grammar `.wasm` for a language. Callers wire this up
 * once at startup with whatever WASM blobs they ship. The package itself
 * doesn't bundle grammars — that would balloon install size.
 */
export function registerGrammar(language: string, source: GrammarSource): void {
  grammars.set(language, source);
}

export function hasGrammar(language: string): boolean {
  return grammars.has(language);
}

/** Tree-sitter node types we treat as "symbol boundaries" across languages. */
const SYMBOL_NODE_TYPES = new Set([
  'function_declaration',
  'function_definition',
  'method_declaration',
  'method_definition',
  'class_declaration',
  'class_definition',
  'class_specifier',
  'struct_specifier',
  'struct_item',
  'impl_item',
  'trait_item',
  'enum_declaration',
  'enum_specifier',
  'enum_item',
  'interface_declaration',
  'arrow_function',
  'lexical_declaration', // const foo = () => {}
  'export_statement',
  'module',
  'namespace_declaration',
]);

type TSNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number };
  endPosition: { row: number };
  childCount: number;
  child(i: number): TSNode | null;
  childForFieldName?: (name: string) => TSNode | null;
  text?: string;
};

function findSymbolName(node: TSNode, source: string): string | undefined {
  const named = node.childForFieldName?.('name');
  if (named) return source.slice(named.startIndex, named.endIndex);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === 'identifier') return source.slice(c.startIndex, c.endIndex);
  }
  return undefined;
}

/**
 * Walk the parse tree top-down, collecting the highest-level nodes that look
 * like a symbol (function / class / etc). Anything not covered by a symbol
 * (imports, top-level statements, gaps between symbols) is emitted as plain
 * size-chunked filler so we never lose bytes.
 */
function collectSymbolSpans(
  root: TSNode,
  source: string,
): Array<{ start: number; end: number; name?: string }> {
  const spans: Array<{ start: number; end: number; name?: string }> = [];

  const visit = (node: TSNode): void => {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      spans.push({
        start: node.startIndex,
        end: node.endIndex,
        name: findSymbolName(node, source),
      });
      return; // don't recurse — methods inside a class stay inside the class span
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) visit(c);
    }
  };

  visit(root);
  return spans.sort((a, b) => a.start - b.start);
}

function lineNumberAt(source: string, index: number): number {
  // 1-based line number containing `index`.
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

export type ChunkBySymbolsOptions = {
  maxChars?: number;
  overlapChars?: number;
};

/**
 * AST-aware chunker. Splits `text` along top-level symbol boundaries for the
 * given `language`. Any span larger than `maxChars` is further split with
 * `chunkBySize`. Falls back to `chunkBySize` outright if no grammar is
 * registered for the language, or if tree-sitter fails to load.
 */
export async function chunkBySymbols(
  text: string,
  language: string,
  opts: ChunkBySymbolsOptions = {},
): Promise<Chunk[]> {
  const maxChars = opts.maxChars ?? 1500;
  const overlapChars = opts.overlapChars ?? 100;

  if (!grammars.has(language)) {
    return chunkBySize(text, maxChars, overlapChars);
  }

  try {
    const Parser = await ensureParserInitialized();
    const grammarSource = grammars.get(language) as GrammarSource;
    const lang = await Parser.Language.load(grammarSource);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(text);
    const spans = collectSymbolSpans(tree.rootNode as unknown as TSNode, text);
    return spansToChunks(spans, text, maxChars, overlapChars);
  } catch {
    return chunkBySize(text, maxChars, overlapChars);
  }
}

// ---------------------------------------------------------------------------
// Symbol / call / import extraction (same parse, different output)
// ---------------------------------------------------------------------------

import { extractFromTree, type ExtractNode, type ExtractionResult } from './symbol-extraction.js';

export type {
  ExtractionResult,
  RawSymbol,
  RawCall,
  RawImport,
  SymbolKind,
  SourceLocation,
} from './symbol-extraction.js';

export type ExtractSymbolsOptions = {
  code: string;
  language: string;
  filePath: string;
};

/**
 * Emit an `ExtractionResult` (symbols + edges-via-parentId + raw calls +
 * imports) from the SAME tree-sitter parse `chunkBySymbols` uses. Returns an
 * empty result if no grammar is registered for the language or the parse fails
 * — extraction is best-effort and never throws to the caller.
 *
 * The shape is a structural twin of `@opencodex/code-graph`'s contract; we do
 * not import that package (it would create a dependency cycle).
 */
export async function extractSymbols(opts: ExtractSymbolsOptions): Promise<ExtractionResult> {
  const empty: ExtractionResult = { symbols: [], calls: [], imports: [] };
  if (!grammars.has(opts.language)) return empty;

  try {
    const Parser = await ensureParserInitialized();
    const grammarSource = grammars.get(opts.language) as GrammarSource;
    const lang = await Parser.Language.load(grammarSource);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(opts.code);
    return extractFromTree(tree.rootNode as unknown as ExtractNode, {
      source: opts.code,
      language: opts.language,
      filePath: opts.filePath,
    });
  } catch {
    return empty;
  }
}

function spansToChunks(
  spans: Array<{ start: number; end: number; name?: string }>,
  source: string,
  maxChars: number,
  overlapChars: number,
): Chunk[] {
  if (spans.length === 0) return chunkBySize(source, maxChars, overlapChars);

  const out: Chunk[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      const filler = source.slice(cursor, span.start);
      if (filler.trim().length > 0) {
        const fillerChunks = chunkBySize(filler, maxChars, overlapChars);
        const baseLine = lineNumberAt(source, cursor) - 1;
        for (const c of fillerChunks) {
          out.push({
            ...c,
            startLine: c.startLine + baseLine,
            endLine: c.endLine + baseLine,
          });
        }
      }
    }

    const body = source.slice(span.start, span.end);
    const startLine = lineNumberAt(source, span.start);
    if (body.length <= maxChars) {
      const endLine = lineNumberAt(source, span.end);
      out.push({ content: body, startLine, endLine, symbolPath: span.name });
    } else {
      const subChunks = chunkBySize(body, maxChars, overlapChars);
      const baseLine = startLine - 1;
      for (const c of subChunks) {
        out.push({
          content: c.content,
          startLine: c.startLine + baseLine,
          endLine: c.endLine + baseLine,
          symbolPath: span.name,
        });
      }
    }
    cursor = span.end;
  }

  if (cursor < source.length) {
    const tail = source.slice(cursor);
    if (tail.trim().length > 0) {
      const tailChunks = chunkBySize(tail, maxChars, overlapChars);
      const baseLine = lineNumberAt(source, cursor) - 1;
      for (const c of tailChunks) {
        out.push({
          ...c,
          startLine: c.startLine + baseLine,
          endLine: c.endLine + baseLine,
        });
      }
    }
  }

  return out;
}
