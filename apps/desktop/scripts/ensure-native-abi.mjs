#!/usr/bin/env node
// Ensures the better-sqlite3 native binary matches the requested ABI.
//
// `apps/desktop` uses better-sqlite3 from two runtimes:
//
//   - `pnpm dev` / packaged app → Electron 30 (NODE_MODULE_VERSION 123)
//   - `pnpm test` (vitest)      → Node 20    (NODE_MODULE_VERSION 115)
//
// Only one .node binary lives in node_modules at a time. To avoid the wasted
// time of running `electron-rebuild` on every `pnpm dev`, we write a sentinel
// file alongside the binary recording which ABI we last built it for, and
// skip the rebuild when the sentinel already matches the request.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(SELF_DIR, '..');

const want = process.argv[2];
if (want !== 'node' && want !== 'electron') {
  console.error('usage: ensure-native-abi.mjs <node|electron>');
  process.exit(2);
}

function findBinaryDir() {
  // Resolve the .node path via the package the caller would actually load.
  // pnpm hoists better-sqlite3 under a content-addressed dir, so we can't
  // hard-code the path.
  try {
    const req = createRequire(`${DESKTOP_DIR.replaceAll('\\', '/')}/`);
    const pkgPath = req.resolve('better-sqlite3/package.json');
    return join(dirname(pkgPath), 'build', 'Release');
  } catch {
    return null;
  }
}

const binDir = findBinaryDir();
const sentinelPath = binDir ? join(binDir, '.opencodex-abi') : null;

function readSentinel() {
  if (!sentinelPath || !existsSync(sentinelPath)) return null;
  try {
    return readFileSync(sentinelPath, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeSentinel(value) {
  if (!sentinelPath) return;
  try {
    writeFileSync(sentinelPath, value);
  } catch {
    // Non-fatal — sentinel is purely an optimization.
  }
}

function tryLoad() {
  try {
    const req = createRequire(`${DESKTOP_DIR.replaceAll('\\', '/')}/`);
    const Database = req('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      err: msg,
      abiMismatch: msg.includes('NODE_MODULE_VERSION') || msg.includes('ERR_DLOPEN_FAILED'),
    };
  }
}

// Fast-path: sentinel says we already built for the requested ABI.
const sentinel = readSentinel();
if (sentinel === want) process.exit(0);

// Slower-path: sentinel is absent or stale.
//   - For `want === 'node'`, we can probe the loader to confirm — Node loads
//     the binary if and only if it was built for the matching Node ABI.
//   - For `want === 'electron'`, we can't probe under Node (different ABI on
//     purpose). Trust the sentinel; if it says 'electron' but we got here,
//     it didn't match → rebuild. If the sentinel is null (first run), we
//     have to rebuild to know.
if (want === 'node') {
  const probe = tryLoad();
  if (probe.ok) {
    writeSentinel('node');
    process.exit(0);
  }
  if (!probe.abiMismatch) {
    console.error('[ensure-native-abi] unexpected failure loading better-sqlite3:');
    console.error(probe.err);
    process.exit(1);
  }
}

const cmd =
  want === 'node'
    ? 'pnpm rebuild better-sqlite3'
    : 'pnpm exec electron-rebuild -f -w better-sqlite3';

console.error(`[ensure-native-abi] rebuilding better-sqlite3 for ${want} ABI...`);
try {
  execSync(cmd, { cwd: DESKTOP_DIR, stdio: 'inherit' });
} catch {
  console.error(`[ensure-native-abi] rebuild failed; run \`${cmd}\` manually from apps/desktop.`);
  process.exit(1);
}
writeSentinel(want);
console.error('[ensure-native-abi] done.');
