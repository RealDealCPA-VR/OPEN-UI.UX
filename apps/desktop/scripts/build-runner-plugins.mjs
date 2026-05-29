#!/usr/bin/env node
// Bundles each bundled runner plugin (claude-code, opencode, aider) into a
// single self-contained ESM file at <package>/dist/index.js so they can be
// shipped via electron-builder's extraResources and installed in-app with one
// click. Inlines all workspace deps (zod, @opencodex/core) — the runtime host
// passes the PluginHost in, so the plugin module has no need for a node_modules
// tree at its install location.

import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');

const PLUGINS = [
  { id: 'runner-claude-code', package: 'runner-claude-code' },
  { id: 'runner-opencode', package: 'runner-opencode' },
  { id: 'runner-aider', package: 'runner-aider' },
];

async function bundlePlugin(plugin) {
  const pkgDir = join(repoRoot, 'packages', plugin.package);
  const entry = join(pkgDir, 'src/index.ts');
  const distDir = join(pkgDir, 'dist');
  const outfile = join(distDir, 'index.js');

  if (!existsSync(entry)) {
    throw new Error(`entry not found: ${entry}`);
  }

  // Only remove our own bundle outputs from a previous esbuild run — do NOT
  // wipe the whole dist/ directory, because `pnpm -r build` ran tsc just
  // before this step and emitted .d.ts / .d.ts.map files into the same
  // directory that downstream consumers (the desktop app, plugin authors
  // importing types) rely on.
  if (existsSync(distDir)) {
    for (const entry of readdirSync(distDir)) {
      if (entry === 'index.js' || entry === 'index.js.map') {
        rmSync(join(distDir, entry), { force: true });
      }
    }
  } else {
    mkdirSync(distDir, { recursive: true });
  }

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
    // The plugin only needs to load itself + its userland deps. node:* stays external;
    // electron and the plugin SDK are erased (the SDK is type-only in plugin code).
    external: ['electron'],
    logLevel: 'warning',
    alias: {
      '@opencodex/core': join(repoRoot, 'packages/core/src/index.ts'),
      '@opencodex/core/process/tree-kill': join(repoRoot, 'packages/core/src/process/tree-kill.ts'),
      '@opencodex/plugin-sdk': join(repoRoot, 'packages/plugin-sdk/src/index.ts'),
    },
  });

  const manifestSrc = join(pkgDir, 'opencodex.plugin.json');
  if (existsSync(manifestSrc)) {
    copyFileSync(manifestSrc, join(distDir, '..', 'opencodex.plugin.json'));
  }

  return outfile;
}

async function main() {
  const built = [];
  for (const plugin of PLUGINS) {
    process.stdout.write(`Bundling ${plugin.id}… `);
    const out = await bundlePlugin(plugin);
    process.stdout.write(`${out}\n`);
    built.push(plugin.id);
  }
  console.log(`Bundled ${built.length} runner plugin(s).`);
}

main().catch((err) => {
  console.error('Failed to bundle runner plugins:', err);
  process.exit(1);
});
