export interface CitationToken {
  kind: 'text' | 'citation';
  text: string;
  file?: string;
  line?: number;
}

const CITATION_RE = /(\b[\w./\\-]+\.[\w]{1,8}):(\d+)(?::(\d+))?\b/g;

export function tokenizeCitations(input: string): CitationToken[] {
  const tokens: CitationToken[] = [];
  let lastIndex = 0;
  for (const m of input.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) tokens.push({ kind: 'text', text: input.slice(lastIndex, start) });
    tokens.push({
      kind: 'citation',
      text: m[0],
      file: m[1] ?? '',
      line: Number(m[2] ?? '0'),
    });
    lastIndex = start + m[0].length;
  }
  if (lastIndex < input.length) tokens.push({ kind: 'text', text: input.slice(lastIndex) });
  return tokens;
}
