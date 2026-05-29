import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';

export interface IgnoreMatcher {
  matches(relativePath: string): boolean;
}

type CompiledRule = {
  pattern: string;
  negated: boolean;
  anchored: boolean;
  dirOnly: boolean;
  match: (rel: string) => boolean;
};

const PICOMATCH_OPTS: picomatch.PicomatchOptions = {
  dot: true,
  nocase: false,
  posixSlashes: true,
};

function buildPicomatch(pattern: string, anchored: boolean): (rel: string) => boolean {
  const variants: string[] = [];
  if (anchored) {
    variants.push(pattern, `${pattern}/**`);
  } else {
    variants.push(pattern, `**/${pattern}`, `**/${pattern}/**`, `${pattern}/**`);
  }
  const matchers = variants.map((p) => picomatch(p, PICOMATCH_OPTS));
  return (rel: string): boolean => matchers.some((m) => m(rel));
}

function compilePattern(raw: string): CompiledRule | null {
  let pattern = raw.trim();
  if (pattern.length === 0) return null;
  if (pattern.startsWith('#')) return null;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  }
  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);
  const dirOnly = pattern.endsWith('/');
  if (dirOnly) pattern = pattern.slice(0, -1);
  if (pattern.length === 0) return null;

  const match = buildPicomatch(pattern, anchored);
  return { pattern, negated, anchored, dirOnly, match };
}

export function parseIgnoreFile(content: string): CompiledRule[] {
  return content
    .split(/\r?\n/)
    .map((line) => compilePattern(line))
    .filter((rule): rule is CompiledRule => rule !== null);
}

export function createIgnoreMatcher(rules: CompiledRule[]): IgnoreMatcher {
  return {
    matches(relativePath: string): boolean {
      const normalized = relativePath.replaceAll('\\', '/');
      let ignored = false;
      for (const rule of rules) {
        if (rule.match(normalized)) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    },
  };
}

export function readIgnoreMatcherForWorkspace(workspaceRoot: string): IgnoreMatcher {
  const rules: CompiledRule[] = [];
  for (const filename of ['.gitignore', '.opencodexignore']) {
    const path = join(workspaceRoot, filename);
    if (existsSync(path)) {
      try {
        rules.push(...parseIgnoreFile(readFileSync(path, 'utf8')));
      } catch {
        // ignore unreadable
      }
    }
  }
  return createIgnoreMatcher(rules);
}
