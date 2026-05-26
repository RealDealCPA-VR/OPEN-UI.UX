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

export function resolveVaultPath(vaultRoot: string, requested: string): string {
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
  const rel = path.relative(absRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new VaultPathError(requested, vaultRoot, 'escapes vault root');
  }
  return resolved;
}

export function ensureMarkdownExtension(p: string): string {
  return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
}
