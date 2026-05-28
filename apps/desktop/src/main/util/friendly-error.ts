/**
 * Map common Node.js errno codes and SQLite errors to one-line user-readable
 * strings so the renderer never sees raw `Error: ENOENT: no such file...`-style
 * messages. Falls back to the original `Error.message` when no mapping applies.
 *
 * Use at the seam between main-process work (filesystem, sqlite, network) and
 * IPC responses. Do NOT use for programmer errors (Zod validation, missing
 * tool, unknown provider) — those already carry good messages.
 */

interface NodeError {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
  message?: string;
}

interface SqliteError {
  code?: string;
  message?: string;
}

function tryShortenPath(path: string | undefined): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

export function friendlyErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';

  if (typeof err === 'string') return err;

  if (typeof err !== 'object') return String(err);

  const e = err as NodeError & SqliteError;
  const code = typeof e.code === 'string' ? e.code : null;
  const shortPath = tryShortenPath(e.path);

  switch (code) {
    case 'ENOENT':
      return shortPath ? `File not found: ${shortPath}` : 'File not found';
    case 'EACCES':
      return shortPath ? `Permission denied: ${shortPath}` : 'Permission denied';
    case 'EPERM':
      return shortPath ? `Operation not permitted on ${shortPath}` : 'Operation not permitted';
    case 'EBUSY':
      return shortPath ? `File is in use by another process: ${shortPath}` : 'Resource is busy';
    case 'EEXIST':
      return shortPath ? `Already exists: ${shortPath}` : 'Already exists';
    case 'EISDIR':
      return shortPath
        ? `Expected a file, found a directory: ${shortPath}`
        : 'Expected a file, found a directory';
    case 'ENOTDIR':
      return shortPath
        ? `Expected a directory, found a file: ${shortPath}`
        : 'Expected a directory, found a file';
    case 'ENOSPC':
      return 'Disk is full';
    case 'EMFILE':
    case 'ENFILE':
      return 'Too many open files — try again in a moment';
    case 'ETIMEDOUT':
      return 'Request timed out';
    case 'ECONNREFUSED':
      return 'Could not connect — the service is not running or refused the connection';
    case 'ECONNRESET':
      return 'Connection was reset by the remote host';
    case 'ENETUNREACH':
      return 'Network is unreachable — check your internet connection';
    case 'EHOSTUNREACH':
      return 'Host is unreachable';
    case 'EAI_AGAIN':
    case 'ENOTFOUND':
      return 'Could not resolve host — check the URL and your network';
    case 'SQLITE_BUSY':
      return 'Database is busy — try again';
    case 'SQLITE_LOCKED':
      return 'Database is locked';
    case 'SQLITE_CORRUPT':
      return 'Database is corrupt — restart the app';
    case 'SQLITE_READONLY':
      return 'Database is read-only';
    default:
      break;
  }

  const message = typeof e.message === 'string' ? e.message : '';
  if (message.length > 0) return message;
  return 'Unknown error';
}

/**
 * Wrap an unknown error with a friendly message while preserving the original
 * cause for logging. Returns a fresh Error so the renderer sees only the
 * friendly text via IPC reject.
 */
export function toFriendlyError(err: unknown): Error {
  const message = friendlyErrorMessage(err);
  const wrapped = new Error(message);
  if (err instanceof Error) {
    (wrapped as Error & { cause?: unknown }).cause = err;
  }
  return wrapped;
}
