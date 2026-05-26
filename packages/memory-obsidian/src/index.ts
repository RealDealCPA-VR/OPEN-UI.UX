import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type Tool } from '@opencodex/core';
import { bm25Search, cosine, reciprocalRankFusion, tokenize, type RankedItem } from './bm25';
import { parseFrontMatter, renderFrontMatter } from './front-matter';
import { ensureMarkdownExtension, resolveVaultPath } from './path-guard';
import { bestSnippet } from './snippet';
import { atomicWrite } from './atomic-write';
import { buildVaultIndex, type VaultIndex, type VaultNote } from './vault-index';

export {
  bm25Search,
  cosine,
  reciprocalRankFusion,
  tokenize,
  parseFrontMatter,
  renderFrontMatter,
  resolveVaultPath,
  ensureMarkdownExtension,
  buildVaultIndex,
};
export type { VaultIndex, VaultNote };

export type EmbedFn = (texts: readonly string[]) => Promise<number[][]>;

export interface ObsidianMemoryOptions {
  vaultPath: string;
  embedFn?: EmbedFn;
  refreshMs?: number;
  toolNamePrefix?: string;
}

export interface MemorySearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

export interface MemoryReadResult {
  path: string;
  title: string;
  content: string;
  frontMatter: Record<string, string>;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  noteCount?: number;
}

const DEFAULT_REFRESH_MS = 60_000;

const searchSchema = z.object({
  query: z.string().min(1).describe('Full-text query (BM25 + optional embeddings)'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10'),
});

const readSchema = z.object({
  path: z.string().min(1).describe('Vault-relative path to the note, e.g. "notes/today.md"'),
});

const appendSchema = z.object({
  path: z.string().min(1).describe('Vault-relative path to an existing note'),
  content: z.string().min(1).describe('Markdown content to append at the end of the note'),
});

const createSchema = z.object({
  path: z.string().min(1).describe('Vault-relative path for the new note, e.g. "ideas/foo.md"'),
  title: z.string().min(1).describe('Human title (used in front-matter)'),
  content: z.string().describe('Markdown body of the note'),
  frontMatter: z
    .record(z.string())
    .optional()
    .describe('Optional extra front-matter key/value pairs'),
});

export class ObsidianMemory {
  readonly vaultPath: string;
  private readonly embedFn?: EmbedFn;
  private readonly refreshMs: number;
  private readonly toolNamePrefix: string;
  private cache: VaultIndex | null = null;
  private inFlight: Promise<VaultIndex> | null = null;
  private embeddings: Map<string, { mtimeMs: number; vector: number[] }> = new Map();

  constructor(opts: ObsidianMemoryOptions) {
    this.vaultPath = path.resolve(opts.vaultPath);
    if (opts.embedFn) this.embedFn = opts.embedFn;
    this.refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS;
    this.toolNamePrefix = opts.toolNamePrefix ?? 'memory__obsidian__';
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const idx = await this.getIndex(true);
      return { ok: true, noteCount: idx.notes.size };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  buildTools(): Tool[] {
    const prefix = this.toolNamePrefix;
    const tools: Tool[] = [];
    tools.push(
      defineTool({
        name: `${prefix}memory_search`,
        description:
          'Search the Obsidian vault for notes matching a query. Returns ranked notes with snippets.',
        inputZod: searchSchema,
        permissionTier: 'read',
        execute: async ({ query, limit }): Promise<MemorySearchResult[]> => {
          return this.search(query, limit ?? 10);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}memory_read`,
        description: 'Read the full text of a single note from the Obsidian vault.',
        inputZod: readSchema,
        permissionTier: 'read',
        execute: async ({ path: rel }): Promise<MemoryReadResult> => {
          return this.readNote(rel);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}memory_append`,
        description:
          'Append a markdown block to the end of an existing note in the Obsidian vault. Errors if the note does not exist.',
        inputZod: appendSchema,
        permissionTier: 'write',
        execute: async ({
          path: rel,
          content,
        }): Promise<{ path: string; bytesWritten: number }> => {
          return this.appendNote(rel, content);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}memory_create_note`,
        description:
          'Create a new markdown note in the Obsidian vault. Errors if the note already exists.',
        inputZod: createSchema,
        permissionTier: 'write',
        execute: async ({
          path: rel,
          title,
          content,
          frontMatter,
        }): Promise<{ path: string; bytesWritten: number }> => {
          return this.createNote(rel, title, content, frontMatter ?? {});
        },
      }) as unknown as Tool,
    );
    return tools;
  }

  async search(query: string, limit: number): Promise<MemorySearchResult[]> {
    const idx = await this.getIndex();
    const docs = Array.from(idx.notes.values()).map((n) => ({
      id: n.path,
      tokens: [...n.titleTokens, ...n.titleTokens, ...n.tokens],
    }));
    const bm = bm25Search(query, docs);

    let merged = bm;
    if (this.embedFn) {
      try {
        const embedded = await this.searchWithEmbeddings(query, idx);
        if (embedded && embedded.length > 0) {
          const bmRanked: RankedItem[] = bm.map((h, i) => ({ id: h.id, rank: i }));
          const embRanked: RankedItem[] = embedded.map((h, i) => ({ id: h.id, rank: i }));
          merged = reciprocalRankFusion([bmRanked, embRanked]);
        }
      } catch {
        // fall back to bm25 only
      }
    }

    const top = merged.slice(0, limit);
    const out: MemorySearchResult[] = [];
    for (const hit of top) {
      const note = idx.notes.get(hit.id);
      if (!note) continue;
      out.push({
        path: note.path,
        title: note.title,
        score: hit.score,
        snippet: bestSnippet(note.body, query),
      });
    }
    return out;
  }

  async readNote(relPath: string): Promise<MemoryReadResult> {
    const abs = resolveVaultPath(this.vaultPath, ensureMarkdownExtension(relPath));
    const raw = await fs.readFile(abs, 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const rel = path.relative(path.resolve(this.vaultPath), abs).split(path.sep).join('/');
    const baseName = path.basename(rel, path.extname(rel));
    const title = data['title'] && data['title'].length > 0 ? data['title'] : baseName;
    return { path: rel, title, content: body, frontMatter: data };
  }

  async appendNote(
    relPath: string,
    content: string,
  ): Promise<{ path: string; bytesWritten: number }> {
    const abs = resolveVaultPath(this.vaultPath, ensureMarkdownExtension(relPath));
    const existing = await fs.readFile(abs, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        throw new Error(`Note not found: ${relPath}. Use memory_create_note to create it.`);
      }
      throw err;
    });
    const sep = existing.endsWith('\n') ? '' : '\n';
    const block = content.startsWith('\n') ? content : `\n${content}`;
    const next = `${existing}${sep}${block}${content.endsWith('\n') ? '' : '\n'}`;
    await atomicWrite(abs, next);
    this.invalidate();
    const rel = path.relative(path.resolve(this.vaultPath), abs).split(path.sep).join('/');
    return { path: rel, bytesWritten: Buffer.byteLength(next, 'utf8') };
  }

  async createNote(
    relPath: string,
    title: string,
    content: string,
    extraFrontMatter: Record<string, string>,
  ): Promise<{ path: string; bytesWritten: number }> {
    const abs = resolveVaultPath(this.vaultPath, ensureMarkdownExtension(relPath));
    const exists = await fs
      .stat(abs)
      .then(() => true)
      .catch(() => false);
    if (exists) throw new Error(`Note already exists: ${relPath}`);
    const fm: Record<string, string> = { title, ...extraFrontMatter };
    const rendered = `${renderFrontMatter(fm)}\n${content}${content.endsWith('\n') ? '' : '\n'}`;
    await atomicWrite(abs, rendered);
    this.invalidate();
    const rel = path.relative(path.resolve(this.vaultPath), abs).split(path.sep).join('/');
    return { path: rel, bytesWritten: Buffer.byteLength(rendered, 'utf8') };
  }

  invalidate(): void {
    this.cache = null;
  }

  private async getIndex(force = false): Promise<VaultIndex> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.builtAt < this.refreshMs) {
      return this.cache;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = buildVaultIndex(this.vaultPath).then((idx) => {
      this.cache = idx;
      this.inFlight = null;
      return idx;
    });
    try {
      return await this.inFlight;
    } catch (err) {
      this.inFlight = null;
      throw err;
    }
  }

  private async searchWithEmbeddings(
    query: string,
    idx: VaultIndex,
  ): Promise<{ id: string; score: number }[] | null> {
    const embedFn = this.embedFn;
    if (!embedFn) return null;
    const needsEmbedding: { id: string; text: string }[] = [];
    for (const note of idx.notes.values()) {
      const cached = this.embeddings.get(note.path);
      if (!cached || cached.mtimeMs !== note.mtimeMs) {
        needsEmbedding.push({
          id: note.path,
          text: `${note.title}\n\n${note.body}`.slice(0, 8000),
        });
      }
    }
    if (needsEmbedding.length > 0) {
      const vectors = await embedFn(needsEmbedding.map((n) => n.text));
      for (let i = 0; i < needsEmbedding.length; i++) {
        const entry = needsEmbedding[i];
        const vec = vectors[i];
        if (!entry || !vec) continue;
        const note = idx.notes.get(entry.id);
        if (!note) continue;
        this.embeddings.set(entry.id, { mtimeMs: note.mtimeMs, vector: vec });
      }
    }
    const queryVectors = await embedFn([query]);
    const queryVec = queryVectors[0];
    if (!queryVec) return null;
    const hits: { id: string; score: number }[] = [];
    for (const [id, entry] of this.embeddings) {
      if (!idx.notes.has(id)) continue;
      hits.push({ id, score: cosine(queryVec, entry.vector) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }
}
