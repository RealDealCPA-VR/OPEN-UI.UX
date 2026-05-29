import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type Tool } from '@opencodex/core';
import { atomicWrite } from './atomic-write';
import { bm25Search, tokenize } from './bm25';
import { parseSections, sectionId, type MemorySection } from './sections';
import { bestSnippet } from './snippet';

export { atomicWrite, bm25Search, tokenize, parseSections, sectionId, bestSnippet };
export type { MemorySection };

export const DEFAULT_MEMORY_DIRNAME = '.opencodex';
export const DEFAULT_MEMORY_FILENAME = 'memory.md';
export const DEFAULT_MAX_PREPEND_BYTES = 4 * 1024;

export interface LocalFsMemoryOptions {
  workspaceRoot: string;
  toolNamePrefix?: string;
  memoryDirname?: string;
  memoryFilename?: string;
}

export interface LocalSearchHit {
  id: string;
  heading: string;
  score: number;
  snippet: string;
}

export interface LocalReadResult {
  path: string;
  content: string;
  bytes: number;
}

export interface LocalAppendResult {
  path: string;
  bytesWritten: number;
  appendedSection: string;
}

export interface LocalTestConnectionResult {
  ok: boolean;
  error?: string;
  bytes?: number;
  sectionCount?: number;
}

const searchSchema = z.object({
  query: z.string().min(1).describe('Search query (BM25 over markdown sections)'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results, default 5'),
});

const appendSchema = z.object({
  heading: z
    .string()
    .min(1)
    .describe('Section heading to append under. Created at level 2 if it does not exist.'),
  content: z.string().min(1).describe('Markdown content to append'),
});

const readSchema = z.object({});

export class LocalFsMemory {
  readonly workspaceRoot: string;
  readonly memoryPath: string;
  private readonly toolNamePrefix: string;

  constructor(opts: LocalFsMemoryOptions) {
    this.workspaceRoot = path.resolve(opts.workspaceRoot);
    const dirname = opts.memoryDirname ?? DEFAULT_MEMORY_DIRNAME;
    const filename = opts.memoryFilename ?? DEFAULT_MEMORY_FILENAME;
    this.memoryPath = path.join(this.workspaceRoot, dirname, filename);
    this.toolNamePrefix = opts.toolNamePrefix ?? 'memory__local__';
  }

  async testConnection(): Promise<LocalTestConnectionResult> {
    try {
      const raw = await this.readRaw();
      const sections = parseSections(raw);
      return { ok: true, bytes: Buffer.byteLength(raw, 'utf8'), sectionCount: sections.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  buildTools(): Tool[] {
    const prefix = this.toolNamePrefix;
    const tools: Tool[] = [];
    tools.push(
      defineTool({
        name: `${prefix}memory_local_read`,
        description:
          'Read the entire project memory.md file for the active workspace. Returns the markdown body verbatim.',
        inputZod: readSchema,
        permissionTier: 'read',
        execute: async (): Promise<LocalReadResult> => {
          return this.read();
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}memory_local_search`,
        description:
          'Search the project memory.md file for sections matching a query (BM25 over ## headings). Returns ranked sections with snippets.',
        inputZod: searchSchema,
        permissionTier: 'read',
        execute: async ({ query, limit }): Promise<LocalSearchHit[]> => {
          return this.search(query, limit ?? 5);
        },
      }) as unknown as Tool,
    );
    tools.push(
      defineTool({
        name: `${prefix}memory_local_append`,
        description:
          'Append a markdown block to a section of the project memory.md file. Creates the section as a level-2 heading if it does not exist. Atomic write.',
        inputZod: appendSchema,
        permissionTier: 'write',
        execute: async ({ heading, content }): Promise<LocalAppendResult> => {
          return this.append(heading, content);
        },
      }) as unknown as Tool,
    );
    return tools;
  }

  async read(): Promise<LocalReadResult> {
    const raw = await this.readRaw();
    return {
      path: this.memoryPath,
      content: raw,
      bytes: Buffer.byteLength(raw, 'utf8'),
    };
  }

  async search(query: string, limit: number): Promise<LocalSearchHit[]> {
    const raw = await this.readRaw();
    const sections = parseSections(raw);
    if (sections.length === 0) return [];
    const docs = sections.map((s, i) => ({
      id: sectionId(s, i),
      tokens: [...tokenize(s.heading), ...tokenize(s.heading), ...tokenize(s.body)],
    }));
    const hits = bm25Search(query, docs).slice(0, limit);
    const byId = new Map<string, { section: MemorySection; index: number }>();
    sections.forEach((s, i) => byId.set(sectionId(s, i), { section: s, index: i }));
    const out: LocalSearchHit[] = [];
    for (const hit of hits) {
      const found = byId.get(hit.id);
      if (!found) continue;
      out.push({
        id: hit.id,
        heading: found.section.heading,
        score: hit.score,
        snippet: bestSnippet(found.section.body, query),
      });
    }
    return out;
  }

  async append(heading: string, content: string): Promise<LocalAppendResult> {
    const cleanHeading = heading.trim();
    if (cleanHeading.length === 0) {
      throw new Error('heading must not be empty');
    }
    const raw = await this.readRaw();
    const sections = parseSections(raw);
    const target = findSectionByHeading(sections, cleanHeading);
    let next: string;
    if (target) {
      next = appendInSection(raw, sections, target, content);
    } else {
      next = appendNewSection(raw, cleanHeading, content);
    }
    await atomicWrite(this.memoryPath, next);
    return {
      path: this.memoryPath,
      bytesWritten: Buffer.byteLength(next, 'utf8'),
      appendedSection: cleanHeading,
    };
  }

  private async readRaw(): Promise<string> {
    try {
      return await fs.readFile(this.memoryPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return '';
      throw err;
    }
  }
}

function findSectionByHeading(
  sections: readonly MemorySection[],
  heading: string,
): MemorySection | null {
  const target = heading.toLowerCase();
  for (const s of sections) {
    if (s.heading.toLowerCase() === target) return s;
  }
  return null;
}

function appendInSection(
  raw: string,
  sections: readonly MemorySection[],
  target: MemorySection,
  content: string,
): string {
  const lines = raw.split(/\r?\n/);
  const idx = sections.indexOf(target);
  const nextSection = sections[idx + 1];
  const insertLine = nextSection ? nextSection.startLine : lines.length;
  const head = lines.slice(0, insertLine);
  const tail = lines.slice(insertLine);
  while (head.length > target.startLine + 1 && head[head.length - 1] === '') {
    head.pop();
  }
  const block = content.replace(/\s+$/, '');
  head.push('', block, '');
  return [...head, ...tail].join('\n').replace(/\n+$/, '\n');
}

function appendNewSection(raw: string, heading: string, content: string): string {
  const base = raw.replace(/\s+$/, '');
  const sep = base.length === 0 ? '' : '\n\n';
  const block = content.replace(/\s+$/, '');
  return `${base}${sep}## ${heading}\n\n${block}\n`;
}

export function clipForPrompt(raw: string, maxBytes = DEFAULT_MAX_PREPEND_BYTES): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length <= maxBytes) return raw;
  const cut = buf.subarray(0, maxBytes).toString('utf8');
  const lastNewline = cut.lastIndexOf('\n');
  const safe = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  return `${safe}\n\n[... memory.md truncated at ${maxBytes} bytes ...]`;
}
