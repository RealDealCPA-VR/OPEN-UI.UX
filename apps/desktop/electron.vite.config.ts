import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const workspacePackages: Record<string, string> = {
  '@opencodex/core': 'packages/core/src/index.ts',
  '@opencodex/mcp-client': 'packages/mcp-client/src/index.ts',
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

const workspaceAliases = Object.fromEntries(
  Object.entries(workspacePackages).map(([name, relPath]) => [
    name,
    resolve(__dirname, '../..', relPath),
  ]),
);
const workspacePackageNames = Object.keys(workspacePackages);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [...workspacePackageNames, 'electron-store'] })],
    resolve: { alias: workspaceAliases },
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
    plugins: [externalizeDepsPlugin({ exclude: [...workspacePackageNames, 'electron-store'] })],
    resolve: { alias: workspaceAliases },
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
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        ...workspaceAliases,
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
