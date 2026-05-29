import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewDiff, ReviewFile, ReviewHunk, ReviewSource } from '../../shared/review';

const execFileAsync = promisify(execFile);

const MAX_DIFF_BUFFER = 64 * 1024 * 1024;

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  css: 'css',
  html: 'html',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  swift: 'swift',
};

function languageFor(path: string): string {
  const ext = (path.split('.').at(-1) ?? '').toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext';
}

export interface ReviewEngineDeps {
  execGit?: (cwd: string, args: readonly string[]) => Promise<string>;
  execGh?: (cwd: string, args: readonly string[]) => Promise<string>;
}

async function defaultGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: MAX_DIFF_BUFFER,
    windowsHide: true,
  });
  return stdout;
}

async function defaultGh(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', [...args], {
    cwd,
    maxBuffer: MAX_DIFF_BUFFER,
    windowsHide: true,
  });
  return stdout;
}

function parsePrNumberFromUrl(url: string): number | null {
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match || !match[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseHunks(blockBody: string): ReviewHunk[] {
  const hunks: ReviewHunk[] = [];
  const lines = blockBody.split('\n');
  let current: { header: string; bodyLines: string[]; oldStart: number; newStart: number } | null =
    null;
  let oldCursor = 0;
  let newCursor = 0;

  const flush = (): void => {
    if (!current) return;
    const oldCount = current.bodyLines.filter((l) => l.startsWith(' ') || l.startsWith('-')).length;
    const newCount = current.bodyLines.filter((l) => l.startsWith(' ') || l.startsWith('+')).length;
    hunks.push({
      index: hunks.length,
      startLine: current.oldStart,
      endLine: current.oldStart + Math.max(0, oldCount - 1),
      newStartLine: current.newStart,
      newEndLine: current.newStart + Math.max(0, newCount - 1),
      header: current.header,
      content: current.bodyLines.join('\n'),
    });
  };

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush();
      const headerMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      const oldStart = headerMatch && headerMatch[1] ? Number.parseInt(headerMatch[1], 10) : 1;
      const newStart = headerMatch && headerMatch[2] ? Number.parseInt(headerMatch[2], 10) : 1;
      oldCursor = oldStart;
      newCursor = newStart;
      current = { header: line, bodyLines: [], oldStart, newStart };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\ No newline')) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    current.bodyLines.push(line);
    if (line.startsWith(' ')) {
      oldCursor++;
      newCursor++;
    } else if (line.startsWith('-')) {
      oldCursor++;
    } else if (line.startsWith('+')) {
      newCursor++;
    }
  }
  flush();
  // touch cursors to satisfy noUnusedLocals when downstream wants them
  void oldCursor;
  void newCursor;
  return hunks;
}

export function parseUnifiedDiffToFiles(rawDiff: string): ReviewFile[] {
  if (!rawDiff.trim()) return [];
  const blocks = rawDiff.split(/^diff --git /m).slice(1);
  const out: ReviewFile[] = [];
  for (const block of blocks) {
    const blockText = block;
    const firstNewline = blockText.indexOf('\n');
    const headerLine = firstNewline === -1 ? blockText : blockText.slice(0, firstNewline);
    const rest = firstNewline === -1 ? '' : blockText.slice(firstNewline + 1);

    const headerMatch = /^a\/(.+) b\/(.+)$/.exec(headerLine);
    if (!headerMatch) continue;
    const oldPath = headerMatch[1] ?? '';
    const path = headerMatch[2] ?? oldPath;
    if (!path) continue;

    let added = 0;
    let removed = 0;
    for (const line of rest.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }

    out.push({
      path,
      oldPath: oldPath === path ? null : oldPath,
      added,
      removed,
      language: languageFor(path),
      hunks: parseHunks(rest),
      rawDiff: `diff --git ${headerLine}\n${rest}`,
    });
  }
  return out;
}

export async function fetchReviewDiff(
  source: ReviewSource,
  deps: ReviewEngineDeps = {},
): Promise<ReviewDiff> {
  const execGit = deps.execGit ?? defaultGit;
  const execGh = deps.execGh ?? defaultGh;
  const cwd = source.cwd ?? process.cwd();

  let rawDiff = '';
  let baseRef: string | null = null;
  let headRef: string | null = null;
  let prNumber: number | null = null;
  let prUrl: string | null = null;

  if (source.kind === 'local-branch') {
    baseRef = source.base;
    headRef = source.head;
    rawDiff = await execGit(cwd, ['diff', `${source.base}...${source.head}`]);
  } else if (source.kind === 'github-pr-number') {
    prNumber = source.number;
    rawDiff = await execGh(cwd, ['pr', 'diff', String(source.number)]);
  } else {
    prUrl = source.url;
    prNumber = parsePrNumberFromUrl(source.url);
    if (prNumber === null) {
      throw new Error(`Could not parse PR number from URL: ${source.url}`);
    }
    rawDiff = await execGh(cwd, ['pr', 'diff', String(prNumber)]);
  }

  const files = parseUnifiedDiffToFiles(rawDiff);
  return {
    source,
    rawDiff,
    files,
    baseRef,
    headRef,
    prNumber,
    prUrl,
    generatedAt: new Date().toISOString(),
  };
}
