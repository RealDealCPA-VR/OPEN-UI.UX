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
  for (const doc of docs) {
    totalLen += doc.tokens.length;
    const seen = new Set(doc.tokens);
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
  for (const doc of docs) {
    const termCounts = new Map<string, number>();
    for (const t of doc.tokens) {
      if (!queryIdf.has(t)) continue;
      termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
    }
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
