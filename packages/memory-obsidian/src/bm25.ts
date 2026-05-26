export interface BM25Document {
  id: string;
  tokens: string[];
}

export interface BM25Hit {
  id: string;
  score: number;
}

const TOKEN_RE = /[\p{L}\p{N}_]+/gu;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    if (m[0].length > 0) out.push(m[0]);
  }
  return out;
}

export interface BM25Options {
  k1?: number;
  b?: number;
}

export function bm25Search(
  query: string,
  docs: readonly BM25Document[],
  opts: BM25Options = {},
): BM25Hit[] {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || docs.length === 0) return [];

  const docFreq = new Map<string, number>();
  let totalLen = 0;
  const docTokenSets = new Array<Set<string>>(docs.length);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc) continue;
    totalLen += doc.tokens.length;
    const seen = new Set(doc.tokens);
    docTokenSets[i] = seen;
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const avgLen = totalLen / docs.length;
  const n = docs.length;

  const queryIdf = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    queryIdf.set(term, idf);
  }

  const hits: BM25Hit[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc) continue;
    const termCounts = countTerms(doc.tokens, queryIdf);
    if (termCounts.size === 0) continue;
    const dl = doc.tokens.length || 1;
    let score = 0;
    for (const [term, tf] of termCounts) {
      const idf = queryIdf.get(term) ?? 0;
      const denom = tf + k1 * (1 - b + b * (dl / (avgLen || 1)));
      score += idf * ((tf * (k1 + 1)) / denom);
    }
    if (score > 0) hits.push({ id: doc.id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

function countTerms(
  tokens: readonly string[],
  filter: ReadonlyMap<string, number>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (!filter.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RankedItem {
  id: string;
  rank: number;
}

export function reciprocalRankFusion(
  rankings: readonly (readonly RankedItem[])[],
  k = 60,
): BM25Hit[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (const item of ranking) {
      const prev = scores.get(item.id) ?? 0;
      scores.set(item.id, prev + 1 / (k + item.rank));
    }
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
