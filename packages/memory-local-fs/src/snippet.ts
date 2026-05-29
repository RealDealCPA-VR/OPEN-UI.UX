import { tokenize } from './bm25';

export function bestSnippet(body: string, query: string, radius = 100): string {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) {
    return body
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();
  }
  const lower = body.toLowerCase();
  let center = -1;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) {
      center = idx;
      break;
    }
  }
  if (center < 0) {
    return body
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();
  }
  const start = Math.max(0, center - radius);
  const end = Math.min(body.length, center + radius);
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}
