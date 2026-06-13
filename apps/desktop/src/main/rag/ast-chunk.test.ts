import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasGrammar } from '@opencodex/rag-chunker';
import { rmTmp } from '../../test/rm-tmp';
import { languageForPath, registerBundledGrammars, resolveGrammarDir } from './ast-chunk';

const require = createRequire(import.meta.url);
function wasmsOutDir(): string {
  return path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
}

describe('languageForPath', () => {
  it('maps known extensions to their language', () => {
    expect(languageForPath('src/index.ts')).toBe('typescript');
    expect(languageForPath('a.mts')).toBe('typescript');
    expect(languageForPath('a.cts')).toBe('typescript');
    expect(languageForPath('component.tsx')).toBe('tsx');
    expect(languageForPath('script.js')).toBe('javascript');
    expect(languageForPath('view.jsx')).toBe('jsx');
    expect(languageForPath('main.py')).toBe('python');
    expect(languageForPath('main.go')).toBe('go');
    expect(languageForPath('lib.rs')).toBe('rust');
    expect(languageForPath('App.java')).toBe('java');
    expect(languageForPath('a.cpp')).toBe('cpp');
    expect(languageForPath('a.cc')).toBe('cpp');
    expect(languageForPath('a.c')).toBe('c');
    expect(languageForPath('a.h')).toBe('c');
    expect(languageForPath('a.rb')).toBe('ruby');
    expect(languageForPath('a.php')).toBe('php');
    expect(languageForPath('a.cs')).toBe('csharp');
    expect(languageForPath('a.kt')).toBe('kotlin');
    expect(languageForPath('a.swift')).toBe('swift');
  });

  it('returns null for unknown or absent extensions', () => {
    expect(languageForPath('README.md')).toBeNull();
    expect(languageForPath('data.json')).toBeNull();
    expect(languageForPath('Makefile')).toBeNull();
    expect(languageForPath('archive.tar.gz')).toBeNull();
    expect(languageForPath('noext')).toBeNull();
  });

  it('is case-insensitive on the extension', () => {
    expect(languageForPath('Module.TS')).toBe('typescript');
    expect(languageForPath('Component.TSX')).toBe('tsx');
    expect(languageForPath('Main.PY')).toBe('python');
  });
});

describe('registerBundledGrammars', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-ast-grammar-test-'));
  });

  afterEach(async () => {
    await rmTmp(dir);
  });

  async function touch(name: string): Promise<void> {
    await fs.writeFile(path.join(dir, name), '');
  }

  it('returns 0 when the directory does not exist', () => {
    const missing = path.join(dir, 'does-not-exist');
    expect(registerBundledGrammars(missing)).toBe(0);
  });

  it('returns 0 for an empty directory', () => {
    expect(registerBundledGrammars(dir)).toBe(0);
  });

  it('registers only valid, supported tree-sitter wasm files', async () => {
    await touch('tree-sitter-python.wasm');
    await touch('tree-sitter-go.wasm');
    // Unsupported language: filename matches the pattern but is not in SUPPORTED_LANGUAGES.
    await touch('tree-sitter-cobol.wasm');
    // Invalid filenames that must be ignored.
    await touch('python.wasm');
    await touch('tree-sitter-python.txt');
    await touch('tree-sitter-.wasm');
    await touch('notes.md');

    const count = registerBundledGrammars(dir);

    expect(count).toBe(2);
    expect(hasGrammar('python')).toBe(true);
    expect(hasGrammar('go')).toBe(true);
    expect(hasGrammar('cobol')).toBe(false);
  });

  it('does not re-register a grammar already registered', async () => {
    await touch('tree-sitter-rust.wasm');
    const first = registerBundledGrammars(dir);
    expect(first).toBe(1);
    expect(hasGrammar('rust')).toBe(true);

    // Second pass over the same dir: rust is already registered, so nothing new.
    const second = registerBundledGrammars(dir);
    expect(second).toBe(0);
  });

  it('normalizes the tree-sitter-wasms filename token to a supported language', async () => {
    // The package ships C# as `tree-sitter-c_sharp.wasm`; our supported language
    // is `csharp`. registerBundledGrammars must map the token, not skip it.
    await touch('tree-sitter-c_sharp.wasm');

    const count = registerBundledGrammars(dir);

    expect(count).toBe(1);
    expect(hasGrammar('csharp')).toBe(true);
  });

  it('registers the real grammars shipped by the tree-sitter-wasms package', async () => {
    // Copy real package wasm files (raw upstream names, incl. the c_sharp token)
    // into a dir and assert they register under their supported-language names.
    // Uses languages no other test in this file touches so the per-language
    // count is order-independent against the module-level grammar registry.
    const out = wasmsOutDir();
    for (const file of [
      'tree-sitter-typescript.wasm',
      'tree-sitter-java.wasm',
      'tree-sitter-swift.wasm',
    ]) {
      await fs.copyFile(path.join(out, file), path.join(dir, file));
    }

    const count = registerBundledGrammars(dir);

    expect(count).toBe(3);
    expect(hasGrammar('typescript')).toBe(true);
    expect(hasGrammar('java')).toBe(true);
    expect(hasGrammar('swift')).toBe(true);
  });
});

describe('resolveGrammarDir', () => {
  it('returns the first existing candidate and skips empty/missing ones', () => {
    const out = wasmsOutDir();
    expect(resolveGrammarDir(['', path.join(out, 'nope'), out])).toBe(out);
  });

  it('returns null when no candidate exists', () => {
    expect(resolveGrammarDir(['', path.join(os.tmpdir(), 'opencodex-no-such-dir-xyz')])).toBeNull();
  });
});
