import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tokenize } from './bm25';
import { deriveTitle, parseFrontMatter } from './front-matter';

export interface VaultNote {
  path: string;
  title: string;
  body: string;
  frontMatter: Record<string, string>;
  mtimeMs: number;
  tokens: string[];
  titleTokens: string[];
}

export interface VaultIndex {
  notes: ReadonlyMap<string, VaultNote>;
  builtAt: number;
}

export interface BuildOptions {
  signal?: AbortSignal;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export async function buildVaultIndex(
  vaultRoot: string,
  opts: BuildOptions = {},
): Promise<VaultIndex> {
  const root = path.resolve(vaultRoot);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${root}`);
  }
  const notes = new Map<string, VaultNote>();
  await walk(root, root, notes, opts);
  return { notes, builtAt: Date.now() };
}

async function walk(
  root: string,
  current: string,
  out: Map<string, VaultNote>,
  opts: BuildOptions,
): Promise<void> {
  opts.signal?.throwIfAborted();
  const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out, opts);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    const fileStat = await fs.stat(full).catch(() => null);
    if (!fileStat) continue;
    if (fileStat.size > (opts.maxBytes ?? DEFAULT_MAX_BYTES)) continue;
    const raw = await fs.readFile(full, 'utf8').catch(() => null);
    if (raw === null) continue;
    const rel = path.relative(root, full).split(path.sep).join('/');
    const { data, body } = parseFrontMatter(raw);
    const baseName = path.basename(entry.name, path.extname(entry.name));
    const title = deriveTitle(data, body, baseName);
    out.set(rel, {
      path: rel,
      title,
      body,
      frontMatter: data,
      mtimeMs: fileStat.mtimeMs,
      tokens: tokenize(`${title} ${body}`),
      titleTokens: tokenize(title),
    });
  }
}
