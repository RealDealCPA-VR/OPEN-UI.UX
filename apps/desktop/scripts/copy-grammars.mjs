#!/usr/bin/env node
// Copies the supported tree-sitter grammar .wasm files from the
// `tree-sitter-wasms` package into apps/desktop/build/tree-sitter/, normalizing
// filenames to OpenCodex's SUPPORTED_LANGUAGES convention
// (tree-sitter-<lang>.wasm). electron-builder ships build/tree-sitter via
// extraResources to <resourcesPath>/tree-sitter, where registerBundledGrammars
// loads it at runtime. Grammars that are ABI-compatible with web-tree-sitter
// 0.22.x (proven by packages/rag-chunker/src/grammar-load.test.ts).

import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, '..');
const nodeRequire = createRequire(import.meta.url);

// Mirror of SUPPORTED_LANGUAGES in packages/rag-chunker (sans `jsx`, which the
// javascript grammar parses) plus the wasm-package filename for each. A value
// of null means "reuse the javascript grammar under this language's name".
const GRAMMAR_SOURCES = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c: 'tree-sitter-c.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  php: 'tree-sitter-php.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  swift: 'tree-sitter-swift.wasm',
};

function wasmsOutDir() {
  const pkgJson = nodeRequire.resolve('tree-sitter-wasms/package.json');
  return join(dirname(pkgJson), 'out');
}

function main() {
  const outDir = wasmsOutDir();
  const destDir = join(desktopRoot, 'build', 'tree-sitter');

  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  let copied = 0;
  const missing = [];
  for (const [lang, file] of Object.entries(GRAMMAR_SOURCES)) {
    const src = join(outDir, file);
    if (!existsSync(src)) {
      missing.push(`${lang} (${file})`);
      continue;
    }
    copyFileSync(src, join(destDir, `tree-sitter-${lang}.wasm`));
    copied += 1;
  }

  console.log(`Copied ${copied} tree-sitter grammar(s) to ${destDir}.`);
  if (missing.length > 0) {
    console.warn(`Missing grammars (not in tree-sitter-wasms): ${missing.join(', ')}`);
  }
}

main();
