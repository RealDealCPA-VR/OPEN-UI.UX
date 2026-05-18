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

export function resolveWithinWorkspace(workspaceRoot: string, requested: string): string {
  const absRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(absRoot, requested);
  const rel = path.relative(absRoot, resolved);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return resolved;
  }
  throw new PathEscapesWorkspaceError(requested, absRoot);
}
