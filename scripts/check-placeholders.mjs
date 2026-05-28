#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [/@TODO-/, /TODO-org\//, /TODO-repo/, /TODO-set-domain/, /TODO-set-github-handle/];
const IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);
const ALLOWLIST = new Set([
  'PLACEHOLDERS.md',
  'Todo.md',
  'HANDOFF.md',
  'scripts/check-placeholders.mjs',
]);

let hits = 0;
function walk(dir, root) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const rel = full.slice(root.length + 1).replaceAll('\\', '/');
    if (ALLOWLIST.has(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, root);
      continue;
    }
    if (st.size > 5_000_000) continue;
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const pat of PATTERNS) {
        if (pat.test(line)) {
          console.error(`${rel}:${i + 1}: ${line.trim()}`);
          hits++;
          break;
        }
      }
    });
  }
}
walk(process.cwd(), process.cwd());
if (hits) {
  console.error(
    `\nFound ${hits} placeholder string(s). Fill them via PLACEHOLDERS.md or update the allowlist in scripts/check-placeholders.mjs.`,
  );
  process.exit(1);
}
console.log('No placeholder strings found.');
