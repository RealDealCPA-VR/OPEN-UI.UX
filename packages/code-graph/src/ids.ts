const NON_WORD = /[^\p{L}\p{N}_]+/gu;
const MULTI_UNDERSCORE = /_{2,}/g;
const EDGE_UNDERSCORE = /^_+|_+$/g;

/**
 * Canonical reconciliation key for a symbol label.
 *
 * Deterministic by contract: identical inputs across runs (and across machines)
 * MUST produce identical output, because this key is what dedup/merge join on.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFKC')
    .replace(NON_WORD, '_')
    .replace(MULTI_UNDERSCORE, '_')
    .replace(EDGE_UNDERSCORE, '')
    .toLowerCase();
}

/** Join id parts with a stable separator; empty/blank parts are dropped. */
export function makeNodeId(parts: ReadonlyArray<string>): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join('::');
}
