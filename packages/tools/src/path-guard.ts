import { promises as fs } from 'node:fs';
import path from 'node:path';

export class PathEscapesWorkspaceError extends Error {
  constructor(
    public readonly requested: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${requested}" escapes workspace root "${workspaceRoot}"`);
    this.name = 'PathEscapesWorkspaceError';
  }
}

// Cache the realpath of each workspace root. Realpath is filesystem I/O and
// the answer doesn't change unless the operator deliberately re-points the
// workspace at a different filesystem location during a session.
const realRootCache = new Map<string, string>();

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

// Walk up the path until we find an ancestor that exists; return the existing
// ancestor and the (possibly empty) trailing components that don't exist yet.
// This lets writes that create new files / directories realpath-verify against
// whatever real directory the parent chain currently points at.
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

// Lexical check ONLY — kept for the rare caller that genuinely needs a sync
// version (e.g. argv parsing before any I/O is allowed). Prefer
// `resolveWithinWorkspace` (async, realpath-verified) everywhere else.
export function resolveWithinWorkspaceSync(workspaceRoot: string, requested: string): string {
  const absRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(absRoot, requested);
  if (isUnderRoot(absRoot, resolved)) return resolved;
  throw new PathEscapesWorkspaceError(requested, absRoot);
}

// Resolve `requested` relative to `workspaceRoot`, but also verify the result
// stays under the workspace AFTER following symlinks. The bare lexical check
// (still done first) catches obvious `..` attacks; the realpath pass catches
// the harder case: a symlink that lives INSIDE the workspace but points
// outside it (e.g. an innocent pnpm `node_modules/.pnpm/...` symlink farm
// pointing to a vendored dep, OR an attacker-planted `link -> /etc`).
//
// For not-yet-existing paths (writes that will create new files / dirs), we
// realpath the deepest existing ancestor and re-join the unresolved tail —
// otherwise `fs.realpath` would throw ENOENT for any write to a new path.
//
// This protects read_file / write_file / edit_file / list_dir / glob / grep /
// run_shell.cwd from following a symlink out of the workspace.
export async function resolveWithinWorkspace(
  workspaceRoot: string,
  requested: string,
): Promise<string> {
  const absRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(absRoot, requested);

  // Fast-path: pure-lexical rejection (no I/O) catches the simple `..` attack
  // and lets us bail before paying for the realpath round-trip.
  if (!isUnderRoot(absRoot, resolved)) {
    throw new PathEscapesWorkspaceError(requested, absRoot);
  }

  let realRoot = realRootCache.get(absRoot);
  if (!realRoot) {
    realRoot = await realpathOrSelf(absRoot);
    realRootCache.set(absRoot, realRoot);
  }

  const { existing, tail } = await deepestExisting(resolved);
  const realExisting = await realpathOrSelf(existing);
  const realResolved = tail ? path.join(realExisting, tail) : realExisting;

  if (!isUnderRoot(realRoot, realResolved)) {
    throw new PathEscapesWorkspaceError(requested, absRoot);
  }
  return resolved;
}
