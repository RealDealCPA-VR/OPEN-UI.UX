import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger';
import type {
  ListConflictsResponse,
  MergeConflictHunk,
  ResolveConflictRequest,
  ResolveConflictResponse,
} from '../../shared/git-workflow';

const execFileAsync = promisify(execFile);

export interface ConflictResolverDeps {
  runGit?: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

async function defaultRunGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}

const CONFLICT_OPEN = '<<<<<<<';
const CONFLICT_BASE = '|||||||';
const CONFLICT_MID = '=======';
const CONFLICT_CLOSE = '>>>>>>>';

export function parseConflictMarkers(
  filePath: string,
  content: string,
  startIndex = 0,
): MergeConflictHunk[] {
  const lines = content.split('\n');
  const out: MergeConflictHunk[] = [];
  let i = 0;
  let counter = startIndex;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith(CONFLICT_OPEN)) {
      i++;
      continue;
    }
    const startLine = i + 1;
    const ours: string[] = [];
    const theirs: string[] = [];
    const base: string[] = [];
    let mode: 'ours' | 'base' | 'theirs' = 'ours';
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.startsWith(CONFLICT_BASE)) {
        mode = 'base';
        i++;
        continue;
      }
      if (l.startsWith(CONFLICT_MID)) {
        mode = 'theirs';
        i++;
        continue;
      }
      if (l.startsWith(CONFLICT_CLOSE)) {
        const endLine = i + 1;
        out.push({
          index: counter++,
          filePath,
          startLine,
          endLine,
          ours: ours.join('\n'),
          theirs: theirs.join('\n'),
          base: base.length > 0 ? base.join('\n') : null,
        });
        i++;
        break;
      }
      if (mode === 'ours') ours.push(l);
      else if (mode === 'base') base.push(l);
      else theirs.push(l);
      i++;
    }
  }
  return out;
}

export async function listConflicts(
  repoRoot: string,
  deps: ConflictResolverDeps = {},
): Promise<ListConflictsResponse> {
  const runGit = deps.runGit ?? defaultRunGit;
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
  try {
    const { stdout } = await runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U']);
    const files = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const hunks: MergeConflictHunk[] = [];
    let cursor = 0;
    for (const rel of files) {
      const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
      try {
        const content = await read(abs);
        const parsed = parseConflictMarkers(rel, content, cursor);
        cursor += parsed.length;
        hunks.push(...parsed);
      } catch (err) {
        logger.warn({ err, abs }, 'failed to read conflicted file');
      }
    }
    return { hunks };
  } catch (err) {
    logger.warn({ err }, 'listConflicts failed');
    return { hunks: [] };
  }
}

function rebuildResolved(
  content: string,
  decisions: ReadonlyMap<number, 'ours' | 'theirs' | 'both'>,
): { resolved: string; remaining: number } {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  let counter = 0;
  let remaining = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith(CONFLICT_OPEN)) {
      out.push(line);
      i++;
      continue;
    }
    const ours: string[] = [];
    const theirs: string[] = [];
    let mode: 'ours' | 'base' | 'theirs' = 'ours';
    const blockStart = i;
    i++;
    let closed = false;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.startsWith(CONFLICT_BASE)) {
        mode = 'base';
        i++;
        continue;
      }
      if (l.startsWith(CONFLICT_MID)) {
        mode = 'theirs';
        i++;
        continue;
      }
      if (l.startsWith(CONFLICT_CLOSE)) {
        i++;
        closed = true;
        break;
      }
      if (mode === 'ours') ours.push(l);
      else if (mode === 'theirs') theirs.push(l);
      i++;
    }
    if (!closed) {
      for (let j = blockStart; j < lines.length; j++) {
        const l = lines[j];
        if (l !== undefined) out.push(l);
      }
      remaining++;
      break;
    }
    const decision = decisions.get(counter);
    counter++;
    if (decision === 'ours') out.push(...ours);
    else if (decision === 'theirs') out.push(...theirs);
    else if (decision === 'both') {
      out.push(...ours);
      out.push(...theirs);
    } else {
      out.push(CONFLICT_OPEN);
      out.push(...ours);
      out.push(CONFLICT_MID);
      out.push(...theirs);
      out.push(CONFLICT_CLOSE);
      remaining++;
    }
  }
  return { resolved: out.join('\n'), remaining };
}

export async function resolveConflict(
  req: ResolveConflictRequest,
  deps: ConflictResolverDeps = {},
): Promise<ResolveConflictResponse> {
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
  const write = deps.writeFile ?? ((p: string, c: string) => writeFile(p, c, 'utf8'));
  const runGit = deps.runGit ?? defaultRunGit;
  const abs = path.isAbsolute(req.filePath) ? req.filePath : path.join(req.repoRoot, req.filePath);
  try {
    const content = await read(abs);
    const decisions = new Map<number, 'ours' | 'theirs' | 'both'>([[req.hunkIndex, req.decision]]);
    const { resolved, remaining } = rebuildResolved(content, decisions);
    await write(abs, resolved);
    if (remaining === 0) {
      try {
        await runGit(req.repoRoot, ['add', req.filePath]);
      } catch (err) {
        logger.debug({ err }, 'git add after resolve failed');
      }
    }
    return { ok: true, remainingHunks: remaining };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, remainingHunks: -1, error: message };
  }
}
