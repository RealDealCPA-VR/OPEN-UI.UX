import { existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  chunkBySize,
  chunkBySymbols,
  registerGrammar,
  hasGrammar,
  SUPPORTED_LANGUAGES,
  type Chunk,
  type SupportedLanguage,
} from '@opencodex/rag-chunker';
import { logger } from '../logger';
import type { ChunkFn } from './multi-workspace-indexer';

const MAX_CHARS = 1500;
const OVERLAP_CHARS = 100;

const EXT_TO_LANGUAGE: Readonly<Record<string, SupportedLanguage>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
};

export function languageForPath(path: string): SupportedLanguage | null {
  return EXT_TO_LANGUAGE[extname(path).toLowerCase()] ?? null;
}

/**
 * The `<lang>` token parsed out of a `tree-sitter-<lang>.wasm` filename does not
 * always equal one of `SUPPORTED_LANGUAGES`. The `tree-sitter-wasms` package
 * ships some grammars under upstream tree-sitter names that differ from ours
 * (e.g. `c_sharp` vs our `csharp`). This map normalizes those tokens to a
 * supported language; tokens absent here are used verbatim.
 */
const WASM_TOKEN_ALIASES: Readonly<Record<string, SupportedLanguage>> = {
  c_sharp: 'csharp',
};

function resolveWasmLanguage(token: string): string {
  return WASM_TOKEN_ALIASES[token] ?? token;
}

/**
 * AST-aware chunker for the RAG indexer. Uses `chunkBySymbols` (tree-sitter)
 * when a grammar is registered for the file's language, otherwise falls back to
 * size-based chunking. `chunkBySymbols` itself also falls back internally if the
 * grammar isn't registered or tree-sitter fails to load, so this is always safe
 * to call even before any grammar is bootstrapped.
 */
export const astAwareChunkFn: ChunkFn = (
  text: string,
  path: string,
): Promise<Chunk[]> | Chunk[] => {
  const language = languageForPath(path);
  if (language) {
    return chunkBySymbols(text, language, { maxChars: MAX_CHARS, overlapChars: OVERLAP_CHARS });
  }
  return chunkBySize(text, MAX_CHARS, OVERLAP_CHARS);
};

/**
 * Register bundled tree-sitter grammars from `<dir>/tree-sitter-<lang>.wasm`.
 * Returns the number registered. When the directory is absent or empty, AST
 * chunking stays dormant and `astAwareChunkFn` degrades to size chunking — this
 * is the expected state until the grammar `.wasm` assets are shipped with the
 * app bundle. Bundling those assets (+ the `web-tree-sitter` runtime) is the
 * remaining step to fully activate AST-aware chunking.
 */
export function registerBundledGrammars(dir: string): number {
  if (!existsSync(dir)) {
    logger.info({ dir }, 'AST chunking: no grammar dir found; using size-based chunking');
    return 0;
  }
  let registered = 0;
  try {
    for (const file of readdirSync(dir)) {
      const match = /^tree-sitter-(.+)\.wasm$/.exec(file);
      const token = match?.[1];
      if (!token) continue;
      const lang = resolveWasmLanguage(token);
      if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) continue;
      if (hasGrammar(lang)) continue;
      registerGrammar(lang, join(dir, file));
      registered += 1;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), dir },
      'AST chunking: grammar registration failed',
    );
  }
  if (registered > 0) {
    logger.info({ dir, count: registered }, 'AST chunking: registered tree-sitter grammars');
  } else {
    logger.info({ dir }, 'AST chunking: no supported grammars in dir; using size-based chunking');
  }
  return registered;
}

/**
 * Pick the grammar directory to register from. We try candidates in order and
 * return the first that exists.
 *
 * WHY two locations: in a PACKAGED app the wasm is shipped via
 * electron-builder `extraResources` to `<resourcesPath>/tree-sitter` (see
 * electron-builder.yml + scripts/copy-grammars.mjs). In DEV (`pnpm dev`) there
 * is no packaged resources dir, so we fall back to the `tree-sitter-wasms`
 * package's own `out/` directory inside node_modules — the same source the copy
 * script reads from — so AST chunking is live without a packaging step. The
 * filename token differences (e.g. `c_sharp` -> `csharp`) are normalized by
 * `registerBundledGrammars`, so reading the raw package dir in dev is safe.
 */
export function resolveGrammarDir(candidates: readonly string[]): string | null {
  for (const dir of candidates) {
    if (dir && existsSync(dir)) return dir;
  }
  return null;
}
