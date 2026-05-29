import { logger } from '../logger';

/**
 * Pure substitution helper for skill body templates.
 *
 * Recognized tokens:
 *   {{arg_name}} → looked up in args, falls back to leaving the token as-is
 *                   (unless it matches a built-in name, in which case the
 *                    built-in wins).
 *   {{workspace}} → built-in: current workspace path or '' if unset
 *   {{date}}      → built-in: ISO YYYY-MM-DD
 *   {{git_branch}}→ built-in: current branch of workspace or '' if not a repo
 *
 * Unknown tokens (not in args, not a built-in) are left as-is and a warning
 * is logged. Reserved built-in names cannot be overridden by args.
 */

export interface SubstituteVars {
  args: Record<string, string>;
  workspace: string;
  date: string;
  gitBranch: string;
}

export const BUILT_IN_VAR_NAMES = ['workspace', 'date', 'git_branch'] as const;
export type BuiltInVarName = (typeof BUILT_IN_VAR_NAMES)[number];

const TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface SubstituteResult {
  text: string;
  unknownTokens: string[];
}

function fenceArgValue(name: string, value: string): string {
  const safeValue = value.replace(/<\/arg>/gi, '</arg​>').replace(/<arg(\s|>)/gi, '<arg​$1');
  return `<arg name="${name}">${safeValue}</arg>`;
}

export function substitute(template: string, vars: SubstituteVars): SubstituteResult {
  const unknown = new Set<string>();
  const out = template.replace(TOKEN_RE, (_match, rawName: string) => {
    const name = rawName;
    if (name === 'workspace') return vars.workspace;
    if (name === 'date') return vars.date;
    if (name === 'git_branch') return vars.gitBranch;
    if (Object.prototype.hasOwnProperty.call(vars.args, name)) {
      const v = vars.args[name];
      if (v !== undefined) return fenceArgValue(name, v);
    }
    unknown.add(name);
    return `{{${name}}}`;
  });
  const unknownTokens = Array.from(unknown);
  if (unknownTokens.length > 0) {
    try {
      logger.warn({ unknownTokens }, 'skill substitution left tokens unresolved');
    } catch {
      // logger may be unavailable in tests — silent fallback is fine
    }
  }
  return { text: out, unknownTokens };
}

export function isoDate(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse `key=value` pairs from a skill invocation argument string.
 * The text after `/skill:<name>` is parsed into a flat record. Values may be
 * quoted with double quotes to include spaces. Returns the parsed args and
 * the leftover text that didn't match the key=value pattern.
 *
 * Examples:
 *   parseInvocationArgs('foo=bar baz=qux')
 *     -> { args: { foo: 'bar', baz: 'qux' }, rest: '' }
 *   parseInvocationArgs('topic="security audit" depth=deep')
 *     -> { args: { topic: 'security audit', depth: 'deep' }, rest: '' }
 *   parseInvocationArgs('hello world')
 *     -> { args: {}, rest: 'hello world' }
 */
export interface InvocationArgsParseResult {
  args: Record<string, string>;
  rest: string;
}

const ARG_RE = /([a-zA-Z_][a-zA-Z0-9_]*)=(?:"([^"]*)"|(\S+))/g;

export function parseInvocationArgs(text: string): InvocationArgsParseResult {
  const args: Record<string, string> = {};
  const matchedSpans: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  ARG_RE.lastIndex = 0;
  while ((m = ARG_RE.exec(text)) !== null) {
    const key = m[1];
    const quoted = m[2];
    const bare = m[3];
    if (!key) continue;
    const val = quoted !== undefined ? quoted : (bare ?? '');
    args[key] = val;
    matchedSpans.push([m.index, m.index + m[0].length]);
  }
  let rest = text;
  for (let i = matchedSpans.length - 1; i >= 0; i--) {
    const span = matchedSpans[i];
    if (!span) continue;
    const [start, end] = span;
    rest = rest.slice(0, start) + rest.slice(end);
  }
  return { args, rest: rest.replace(/\s+/g, ' ').trim() };
}
