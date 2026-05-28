import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { shell } from 'electron';
import { z } from 'zod';
import { grepTool, readIgnoreMatcherForWorkspace, resolveWithinWorkspace } from '@opencodex/tools';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { prepareMergeBundle } from '../agent/merge-review';
import { listRuns } from '../agent/run-registry';
import { toFriendlyError } from '../util/friendly-error';
import type {
  CodebasePendingEditsResponse,
  CodebaseReadFileResponse,
  CodebaseSearchHit,
  CodebaseSearchResponse,
} from '../../shared/codebase-search';
import type { PendingEditEntry } from '../../shared/codebase-search';

const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_FILENAME_MATCHES = 500;
const MAX_FILENAME_WALK = 20000;
const DEFAULT_SEARCH_LIMIT = 200;

const searchSchema = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().min(1),
  mode: z.enum(['filename', 'content', 'both']),
  limit: z.number().int().min(1).max(2000).optional(),
});

const readFileSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  maxBytes: z.number().int().min(1).optional(),
});

const showItemSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
});

async function searchFilenames(
  workspaceRoot: string,
  query: string,
  limit: number,
): Promise<CodebaseSearchHit[]> {
  const ignore = readIgnoreMatcherForWorkspace(workspaceRoot);
  const lower = query.toLowerCase();
  const hits: CodebaseSearchHit[] = [];
  let walked = 0;

  async function walk(dir: string): Promise<void> {
    if (hits.length >= limit || walked >= MAX_FILENAME_WALK) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= limit || walked >= MAX_FILENAME_WALK) return;
      walked++;
      const abs = join(dir, entry.name);
      const rel = relative(workspaceRoot, abs).split(sep).join('/');
      if (!rel) continue;
      if (entry.name === '.git') continue;
      if (ignore.matches(rel)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.name.toLowerCase().includes(lower) || rel.toLowerCase().includes(lower)) {
        hits.push({ path: rel, kind: 'filename' });
      }
    }
  }

  await walk(workspaceRoot);
  return hits;
}

async function searchContent(
  workspaceRoot: string,
  query: string,
  limit: number,
): Promise<CodebaseSearchHit[]> {
  const controller = new AbortController();
  const escaped = escapeRegex(query);
  try {
    const matches = await grepTool.execute(
      { pattern: escaped, maxMatches: limit, caseInsensitive: true },
      {
        workspaceRoot,
        signal: controller.signal,
        logger: {
          info: () => undefined,
          error: (msg, meta) => logger.warn({ scope: 'codebase-search', meta }, msg),
        },
      },
    );
    return matches.map((m) => ({
      path: m.file,
      kind: 'content' as const,
      line: m.line,
      snippet: m.text.slice(0, 240),
    }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'codebase content search failed',
    );
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 4096));
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true;
  }
  return false;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  xml: 'xml',
  toml: 'plaintext',
};

function languageFromPath(p: string): string {
  const slashIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const basename = slashIdx >= 0 ? p.slice(slashIdx + 1) : p;
  if (basename.toLowerCase() === 'dockerfile') return 'dockerfile';
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx < 0) return 'plaintext';
  const ext = basename.slice(dotIdx + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

export function registerCodebaseHandlers(): void {
  registerInvoke('codebase:search', searchSchema, async (req): Promise<CodebaseSearchResponse> => {
    const limit = req.limit ?? DEFAULT_SEARCH_LIMIT;
    const fileCap = Math.min(MAX_FILENAME_MATCHES, limit);

    if (req.mode === 'filename') {
      const hits = await searchFilenames(req.workspaceRoot, req.query, fileCap);
      return { hits, truncated: hits.length >= fileCap };
    }
    if (req.mode === 'content') {
      const hits = await searchContent(req.workspaceRoot, req.query, limit);
      return { hits, truncated: hits.length >= limit };
    }
    const halfFile = Math.floor(fileCap / 2);
    const halfContent = Math.floor(limit / 2);
    const [filenames, contents] = await Promise.all([
      searchFilenames(req.workspaceRoot, req.query, halfFile),
      searchContent(req.workspaceRoot, req.query, halfContent),
    ]);
    const hits = [...filenames, ...contents].slice(0, limit);
    return {
      hits,
      truncated: filenames.length >= halfFile || contents.length >= halfContent,
    };
  });

  registerInvoke(
    'codebase:read-file',
    readFileSchema,
    async (req): Promise<CodebaseReadFileResponse> => {
      let resolved: string;
      try {
        resolved = resolveWithinWorkspace(req.workspaceRoot, req.path);
      } catch (err) {
        throw toFriendlyError(err);
      }
      const cap = Math.min(req.maxBytes ?? MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES);
      let sizeBytes: number;
      let buf: Buffer;
      try {
        const stat = await fs.stat(resolved);
        sizeBytes = stat.size;
        buf = await fs.readFile(resolved);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), path: req.path },
          'codebase:read-file failed',
        );
        throw toFriendlyError(err);
      }
      const truncated = buf.length > cap;
      const sliced = truncated ? buf.subarray(0, cap) : buf;
      if (looksBinary(sliced)) {
        return {
          path: req.path,
          content: '(binary file — preview unavailable)',
          language: 'plaintext',
          truncated: false,
          sizeBytes,
        };
      }
      return {
        path: req.path,
        content: sliced.toString('utf8'),
        language: languageFromPath(req.path),
        truncated,
        sizeBytes,
      };
    },
  );

  registerInvoke(
    'codebase:get-pending-edits',
    z.void(),
    async (): Promise<CodebasePendingEditsResponse> => {
      const runs = listRuns();
      const entries: PendingEditEntry[] = [];
      for (const run of runs) {
        if (run.status === 'running') continue;
        if (!run.worktreePath || !run.worktreeBranch || !run.worktreeRepoRoot) continue;
        if (run.mergeStatus !== 'pending') continue;
        try {
          const bundle = await prepareMergeBundle(run.id);
          for (const file of bundle.files) {
            entries.push({ runId: run.id, path: file, branch: bundle.branch });
          }
        } catch (err) {
          logger.debug(
            { runId: run.id, err: err instanceof Error ? err.message : String(err) },
            'pending-edits: prepareMergeBundle failed; skipping run',
          );
        }
      }
      return { entries };
    },
  );

  registerInvoke('shell:show-item-in-folder', showItemSchema, async (req) => {
    try {
      const resolved = resolveWithinWorkspace(req.workspaceRoot, req.path);
      shell.showItemInFolder(resolved);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  registerInvoke('shell:open-path', showItemSchema, async (req) => {
    try {
      const resolved = resolveWithinWorkspace(req.workspaceRoot, req.path);
      const err = await shell.openPath(resolved);
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}
