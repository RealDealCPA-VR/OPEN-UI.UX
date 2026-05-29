import { promises as fs } from 'node:fs';
import path from 'node:path';

export class VaultPathError extends Error {
  constructor(
    public readonly requested: string,
    public readonly vaultRoot: string,
    reason: string,
  ) {
    super(`Vault path "${requested}" rejected: ${reason}`);
    this.name = 'VaultPathError';
  }
}

const realRootCache = new Map<string, string>();

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

async function deepestExisting(p: string): Promise<{ existing: string; tail: string }> {
  let cur = p;
  const tailParts: string[] = [];
  for (;;) {
    try {
      await fs.lstat(cur);
      return { existing: cur, tail: tailParts.length ? path.join(...tailParts) : '' };
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) {
        return { existing: cur, tail: tailParts.length ? path.join(...tailParts) : '' };
      }
      tailParts.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function isUnderRoot(realRoot: string, candidate: string): boolean {
  const rel = path.relative(realRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveVaultPathSync(vaultRoot: string, requested: string): string {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new VaultPathError(requested, vaultRoot, 'empty path');
  }
  if (path.isAbsolute(requested)) {
    throw new VaultPathError(requested, vaultRoot, 'absolute paths are not allowed');
  }
  const normalized = requested.replace(/\\/g, '/');
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new VaultPathError(requested, vaultRoot, 'path traversal segments are not allowed');
  }
  const absRoot = path.resolve(vaultRoot);
  const resolved = path.resolve(absRoot, normalized);
  if (!isUnderRoot(absRoot, resolved)) {
    throw new VaultPathError(requested, vaultRoot, 'escapes vault root');
  }
  return resolved;
}

export async function resolveVaultPath(vaultRoot: string, requested: string): Promise<string> {
  const resolved = resolveVaultPathSync(vaultRoot, requested);
  const absRoot = path.resolve(vaultRoot);

  let realRoot = realRootCache.get(absRoot);
  if (!realRoot) {
    realRoot = await realpathOrSelf(absRoot);
    realRootCache.set(absRoot, realRoot);
  }

  const { existing, tail } = await deepestExisting(resolved);
  const realExisting = await realpathOrSelf(existing);
  const realResolved = tail ? path.join(realExisting, tail) : realExisting;

  if (!isUnderRoot(realRoot, realResolved)) {
    throw new VaultPathError(requested, vaultRoot, 'escapes vault root (symlink)');
  }
  return resolved;
}

export function ensureMarkdownExtension(p: string): string {
  return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
}
