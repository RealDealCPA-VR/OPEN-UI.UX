/*
 * SQLite LIKE-pattern escaping for the audit query + audit export paths.
 *
 * Both call sites previously hand-rolled the same escape, but the query path
 * was the only one declaring `ESCAPE '\'` to SQLite — without that clause the
 * backslashes the export path inserted into the pattern were treated as plain
 * characters, so `%a\_b%` matched literal `a\_b` instead of `a_b`. Unifying on
 * one helper and one clause keeps the two paths in sync.
 */

export const SQLITE_LIKE_ESCAPE_CHAR = '\\';

export const SQLITE_LIKE_ESCAPE_CLAUSE = `ESCAPE '${SQLITE_LIKE_ESCAPE_CHAR}'`;

export function escapeLikeFragment(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `${SQLITE_LIKE_ESCAPE_CHAR}${m}`);
}

export function wrapContains(value: string): string {
  return `%${escapeLikeFragment(value)}%`;
}
