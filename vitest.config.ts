import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@opencodex/core': r('./packages/core/src/index.ts'),
      '@opencodex/provider-openai': r('./packages/provider-openai/src/index.ts'),
      '@opencodex/provider-anthropic': r('./packages/provider-anthropic/src/index.ts'),
      '@opencodex/provider-google': r('./packages/provider-google/src/index.ts'),
      '@opencodex/provider-xai': r('./packages/provider-xai/src/index.ts'),
      '@opencodex/provider-mistral': r('./packages/provider-mistral/src/index.ts'),
      '@opencodex/provider-ollama': r('./packages/provider-ollama/src/index.ts'),
      '@opencodex/provider-openrouter': r('./packages/provider-openrouter/src/index.ts'),
      '@opencodex/tools': r('./packages/tools/src/index.ts'),
      '@opencodex/plugin-sdk': r('./packages/plugin-sdk/src/index.ts'),
      '@opencodex/mcp-client': r('./packages/mcp-client/src/index.ts'),
      '@opencodex/provider-voyage': r('./packages/provider-voyage/src/index.ts'),
      '@opencodex/rag-chunker': r('./packages/rag-chunker/src/index.ts'),
      '@opencodex/memory-obsidian': r('./packages/memory-obsidian/src/index.ts'),
      '@opencodex/memory-notion': r('./packages/memory-notion/src/index.ts'),
      '@opencodex/telemetry': r('./packages/telemetry/src/index.ts'),
      '@opencodex/crash-reporting': r('./packages/crash-reporting/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/*.config.{ts,js,mjs}',
        '**/*.d.ts',
      ],
    },
  },
});
