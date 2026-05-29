#!/usr/bin/env node
// Asserts that each workspace package's `main` (and `types`, if declared)
// actually exists on disk after `pnpm -r build`. Catches the failure mode the
// audit found: a package whose tsconfig has `noEmit: true` while its
// package.json declares `main: dist/index.js` will silently publish broken.
//
// Run AFTER `pnpm -r build` (e.g. as a CI step that immediately follows).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SCOPES = ['packages', 'apps', join('examples', 'plugins')];

const missing = [];
function check(pkgDir) {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;
  const raw = readFileSync(pkgJsonPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return;
  }
  // Skip the desktop app — it builds via electron-vite into `out/`, not `dist/`.
  if (pkg.name === '@opencodex/desktop') return;
  // Skip the website — different lifecycle.
  if (pkg.name === 'opencodex-docs') return;

  const expected = [];
  if (pkg.main) expected.push({ field: 'main', rel: pkg.main });
  if (pkg.types) expected.push({ field: 'types', rel: pkg.types });
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [name, rel] of Object.entries(pkg.bin)) {
      expected.push({ field: `bin.${name}`, rel });
    }
  }

  for (const { field, rel } of expected) {
    const abs = resolve(pkgDir, rel);
    if (!existsSync(abs)) {
      missing.push({ pkg: pkg.name, field, rel, abs: relative(ROOT, abs) });
    }
  }
}

for (const scope of SCOPES) {
  const scopeDir = join(ROOT, scope);
  if (!existsSync(scopeDir)) continue;
  for (const entry of readdirSync(scopeDir)) {
    const full = join(scopeDir, entry);
    if (statSync(full).isDirectory()) check(full);
  }
}

if (missing.length > 0) {
  console.error('Missing build outputs:');
  for (const m of missing) {
    console.error(`  ${m.pkg}: ${m.field} -> ${m.abs}`);
  }
  console.error(`\n${missing.length} declared path(s) do not exist on disk.`);
  console.error(
    'Each is referenced by a package.json field that must point at a file produced by `pnpm -r build`.',
  );
  process.exit(1);
}
console.log('All declared package.json main/types/bin paths exist on disk.');
