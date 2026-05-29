#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATTERNS = [
  /@TODO-/,
  /TODO-org\//,
  /TODO-repo/,
  /TODO-set-domain/,
  /TODO-set-github-handle/,
  /lorem\s+ipsum/i,
  /xxx-xxx-xxx/i,
];
// TODO:/FIXME: markers count as placeholders only in shipping doc files
// (*.md outside the allowlist). Code-comment TODOs are fine — they're
// tracked in Todo.md and flagged by reviewers, not by this script.
const DOC_ONLY_PATTERNS = [/\bTODO:/i, /\bFIXME:/i];

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
  'AUDIT-REPORT.md',
  'scripts/check-placeholders.mjs',
  'scripts/check-placeholders.test.ts',
]);

export function scanText(text, rel) {
  const hits = [];
  const isDoc = rel.endsWith('.md');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const pat of PATTERNS) {
      if (pat.test(line)) {
        hits.push({ rel, lineNumber: i + 1, line: line.trim(), pattern: pat.source });
        return;
      }
    }
    if (isDoc) {
      for (const pat of DOC_ONLY_PATTERNS) {
        if (pat.test(line)) {
          hits.push({ rel, lineNumber: i + 1, line: line.trim(), pattern: pat.source });
          return;
        }
      }
    }
  });
  return hits;
}

function walk(dir, root, accumulator) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const rel = full.slice(root.length + 1).replaceAll('\\', '/');
    if (ALLOWLIST.has(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, root, accumulator);
      continue;
    }
    if (st.size > 5_000_000) continue;
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const hit of scanText(text, rel)) accumulator.push(hit);
  }
}

export function scanDirectory(root) {
  const hits = [];
  walk(root, root, hits);
  return hits;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const hits = scanDirectory(process.cwd());
  for (const hit of hits) console.error(`${hit.rel}:${hit.lineNumber}: ${hit.line}`);
  if (hits.length) {
    console.error(
      `\nFound ${hits.length} placeholder string(s). Fill them via PLACEHOLDERS.md or update the allowlist in scripts/check-placeholders.mjs.`,
    );
    process.exit(1);
  }
  console.log('No placeholder strings found.');
}
