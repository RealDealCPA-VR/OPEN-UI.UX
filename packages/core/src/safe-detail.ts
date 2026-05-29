const MAX_BODY_BYTES = 4 * 1024;

const AUTHORIZATION_PATTERNS: ReadonlyArray<RegExp> = [
  /(authorization\s*[:=]\s*)(bearer\s+)?([a-z0-9._+/-]{8,})/gi,
  /(x-api-key\s*[:=]\s*)([a-z0-9._+/-]{8,})/gi,
  /(api[_-]?key\s*[:=]\s*)["']?([a-z0-9._+/-]{8,})["']?/gi,
  /(sk-[a-z0-9._-]{16,})/gi,
];

/**
 * Strip Authorization-shaped secrets and truncate a response body to a safe
 * size for inclusion in error messages. Provider error events SHOULD pipe
 * raw upstream bodies through this function.
 */
export function sanitizeErrorDetail(raw: string, maxBytes: number = MAX_BODY_BYTES): string {
  let out = raw;
  for (const pat of AUTHORIZATION_PATTERNS) {
    out = out.replace(pat, (_match, ...groups: unknown[]) => {
      const prefix = groups[0];
      if (typeof prefix === 'string' && /:|=/.test(prefix)) return `${prefix}<redacted>`;
      return '<redacted>';
    });
  }
  if (out.length > maxBytes) {
    out = `${out.slice(0, maxBytes)}…[truncated ${String(out.length - maxBytes)} chars]`;
  }
  return out;
}
