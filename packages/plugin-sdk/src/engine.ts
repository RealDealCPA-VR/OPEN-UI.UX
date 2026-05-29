export class EngineMismatchError extends Error {
  constructor(
    public readonly pluginName: string,
    public readonly required: string,
    public readonly host: string,
  ) {
    super(
      `Plugin "${pluginName}" requires opencodex ${required} but host is ${host}. ` +
        'Refusing to install: upgrade OpenCodex or use a compatible plugin version.',
    );
    this.name = 'EngineMismatchError';
  }
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(input: string): ParsedSemver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compare(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Minimal semver-range matcher covering the subset documented in the plugin
 * manifest schema: `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`. Everything else
 * returns false so unknown ranges fail closed rather than silently passing.
 */
export function satisfiesEngineRange(version: string, range: string): boolean {
  const target = parseSemver(version);
  if (!target) return false;
  const trimmed = range.trim();
  if (trimmed === '*' || trimmed === '') return true;

  if (trimmed.startsWith('^')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    if (target.major !== base.major) return false;
    if (base.major === 0) {
      if (target.minor !== base.minor) return false;
      return compare(target, base) >= 0;
    }
    return compare(target, base) >= 0;
  }

  if (trimmed.startsWith('~')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    if (target.major !== base.major || target.minor !== base.minor) return false;
    return target.patch >= base.patch;
  }

  if (trimmed.startsWith('>=')) {
    const base = parseSemver(trimmed.slice(2));
    if (!base) return false;
    return compare(target, base) >= 0;
  }

  const exact = parseSemver(trimmed);
  if (!exact) return false;
  return compare(target, exact) === 0;
}
