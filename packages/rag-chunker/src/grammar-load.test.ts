import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkBySymbols, extractSymbols, registerGrammar } from './index';

// Resolve the on-disk path of a `tree-sitter-wasms` grammar wasm. We resolve
// the package's package.json (it has no JS entry we want) and walk to `out/`.
const require = createRequire(import.meta.url);
function wasmPath(file: string): string {
  const pkgJson = require.resolve('tree-sitter-wasms/package.json');
  return join(dirname(pkgJson), 'out', file);
}

const TS_SNIPPET = `export class A {
  foo() {
    bar();
  }
}
`;

describe('tree-sitter grammar ABI compatibility with web-tree-sitter 0.22.x', () => {
  it('loads the TypeScript grammar and extracts REAL symbols + edges (not size-fallback)', async () => {
    registerGrammar('typescript', wasmPath('tree-sitter-typescript.wasm'));

    const result = await extractSymbols({
      code: TS_SNIPPET,
      language: 'typescript',
      filePath: 'a.ts',
    });

    const classA = result.symbols.find((s) => s.label === 'A' && s.kind === 'class');
    expect(classA, 'class A symbol').toBeDefined();

    const foo = result.symbols.find((s) => s.label === 'foo' && s.kind === 'method');
    expect(foo, 'method foo symbol').toBeDefined();
    expect(foo?.parentId).toBe(classA?.id);

    const barCall = result.calls.find((c) => c.calleeLabel === 'bar');
    expect(barCall, 'call to bar').toBeDefined();
    expect(barCall?.callerId).toBe(foo?.id);
  });

  it('chunkBySymbols splits on real symbol boundaries (not the whole-file size fallback)', async () => {
    registerGrammar('typescript', wasmPath('tree-sitter-typescript.wasm'));

    const twoSymbols = `class A {\n  foo() {\n    bar();\n  }\n}\n\nfunction baz() {\n  qux();\n}\n`;
    const chunks = await chunkBySymbols(twoSymbols, 'typescript', {
      maxChars: 1500,
      overlapChars: 100,
    });

    // The size fallback would emit ONE chunk for this small input. AST chunking
    // splits the two top-level declarations into separate, named spans.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.symbolPath === 'A' && c.content.includes('class A'))).toBe(true);
    expect(chunks.some((c) => c.symbolPath === 'baz' && c.content.includes('function baz'))).toBe(
      true,
    );
  });

  it('loads JavaScript and Python grammars without an ABI error', async () => {
    registerGrammar('javascript', wasmPath('tree-sitter-javascript.wasm'));
    registerGrammar('python', wasmPath('tree-sitter-python.wasm'));

    const js = await extractSymbols({
      code: 'function greet() { say(); }\n',
      language: 'javascript',
      filePath: 'a.js',
    });
    expect(js.symbols.some((s) => s.label === 'greet')).toBe(true);
    expect(js.calls.some((c) => c.calleeLabel === 'say')).toBe(true);

    const py = await extractSymbols({
      code: 'class A:\n    def foo(self):\n        bar()\n',
      language: 'python',
      filePath: 'a.py',
    });
    expect(py.symbols.some((s) => s.label === 'A' && s.kind === 'class')).toBe(true);
    expect(py.symbols.some((s) => s.label === 'foo' && s.kind === 'method')).toBe(true);
    expect(py.calls.some((c) => c.calleeLabel === 'bar')).toBe(true);
  });
});
