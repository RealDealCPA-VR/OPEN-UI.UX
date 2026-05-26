import { tokenize } from './bm25';

export function bestSnippet(body: string, query: string, radius = 100): string {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) {
    return body
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();
  }
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0)
    return body
      .slice(0, radius * 2)
      .replace(/\s+/g, ' ')
      .trim();

  let bestPara = paragraphs[0] ?? '';
  let bestScore = 0;
  for (const para of paragraphs) {
    const tokens = tokenize(para);
    let score = 0;
    for (const t of tokens) if (queryTerms.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestPara = para;
    }
  }
  const lower = bestPara.toLowerCase();
  let center = 0;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) {
      center = idx;
      break;
    }
  }
  const start = Math.max(0, center - radius);
  const end = Math.min(bestPara.length, center + radius);
  const slice = bestPara.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < bestPara.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}
