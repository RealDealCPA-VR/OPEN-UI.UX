import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface IgnoreMatcher {
  matches(relativePath: string): boolean;
}

type Rule = {
  pattern: string;
  negated: boolean;
  anchored: boolean;
  dirOnly: boolean;
  regex: RegExp;
};

function compilePattern(raw: string): Rule | null {
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

  const regex = globToRegex(pattern, anchored);
  return { pattern, negated, anchored, dirOnly, regex };
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let regex = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        regex += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else if (ch === '.' || ch === '+' || ch === '(' || ch === ')' || ch === '|') {
      regex += `\\${ch}`;
    } else {
      regex += ch;
    }
  }
  const prefix = anchored ? '^' : '(^|/)';
  const suffix = '($|/)';
  return new RegExp(`${prefix}${regex}${suffix}`);
}

export function parseIgnoreFile(content: string): Rule[] {
  return content
    .split(/\r?\n/)
    .map((line) => compilePattern(line))
    .filter((rule): rule is Rule => rule !== null);
}

export function createIgnoreMatcher(rules: Rule[]): IgnoreMatcher {
  return {
    matches(relativePath: string): boolean {
      let ignored = false;
      for (const rule of rules) {
        if (rule.regex.test(relativePath)) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    },
  };
}

export function readIgnoreMatcherForWorkspace(workspaceRoot: string): IgnoreMatcher {
  const rules: Rule[] = [];
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
