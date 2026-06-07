import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const workspacePackages: Record<string, string> = {
  '@opencodex/audit-verify': 'packages/audit-verify/src/index.ts',
  '@opencodex/code-graph': 'packages/code-graph/src/index.ts',
  '@opencodex/core': 'packages/core/src/index.ts',
  '@opencodex/mcp-client': 'packages/mcp-client/src/index.ts',
  '@opencodex/memory-local-fs': 'packages/memory-local-fs/src/index.ts',
  '@opencodex/memory-notion': 'packages/memory-notion/src/index.ts',
  '@opencodex/memory-obsidian': 'packages/memory-obsidian/src/index.ts',
  '@opencodex/plugin-sdk': 'packages/plugin-sdk/src/index.ts',
  '@opencodex/provider-anthropic': 'packages/provider-anthropic/src/index.ts',
  '@opencodex/provider-google': 'packages/provider-google/src/index.ts',
  '@opencodex/provider-mistral': 'packages/provider-mistral/src/index.ts',
  '@opencodex/provider-ollama': 'packages/provider-ollama/src/index.ts',
  '@opencodex/provider-openai': 'packages/provider-openai/src/index.ts',
  '@opencodex/provider-openrouter': 'packages/provider-openrouter/src/index.ts',
  '@opencodex/provider-voyage': 'packages/provider-voyage/src/index.ts',
  '@opencodex/provider-xai': 'packages/provider-xai/src/index.ts',
  '@opencodex/rag-chunker': 'packages/rag-chunker/src/index.ts',
  '@opencodex/tools': 'packages/tools/src/index.ts',
  '@opencodex/telemetry': 'packages/telemetry/src/index.ts',
  '@opencodex/crash-reporting': 'packages/crash-reporting/src/index.ts',
};

// Vite resolves alias keys via prefix match: an entry with key `@opencodex/core`
// will also match `@opencodex/core/process/tree-kill`. We need exact-string
// matching here, so the subpath aliases come FIRST in array form using regex,
// and bare-package aliases are anchored with `$`.
const workspaceSubpathAliases = [
  {
    find: /^@opencodex\/core\/process\/tree-kill$/,
    replacement: resolve(__dirname, '../../packages/core/src/process/tree-kill.ts'),
  },
];

const workspaceBareAliases = Object.entries(workspacePackages).map(([name, relPath]) => ({
  find: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}$`),
  replacement: resolve(__dirname, '../..', relPath),
}));

const allAliases = [...workspaceSubpathAliases, ...workspaceBareAliases];
const workspacePackageNames = Object.keys(workspacePackages);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...workspacePackageNames, 'electron-store'] })],
    resolve: { alias: allAliases },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'worker-entry': resolve(__dirname, 'src/main/agent/worker-entry.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: (chunk) =>
            chunk.name === 'worker-entry' ? 'agent/worker-entry.cjs' : '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: [...workspacePackageNames, 'electron-store', 'zod'] }),
    ],
    resolve: { alias: allAliases },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@\/(.*)$/, replacement: `${resolve(__dirname, 'src/renderer')}/$1` },
        { find: /^@shared\/(.*)$/, replacement: `${resolve(__dirname, 'src/shared')}/$1` },
        ...allAliases,
      ],
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
