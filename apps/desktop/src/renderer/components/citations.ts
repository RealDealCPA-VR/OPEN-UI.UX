export interface CitationToken {
  kind: 'text' | 'citation';
  text: string;
  file?: string;
  line?: number;
  endLine?: number;
}

const CITATION_RE = /(\b[\w./\\-]+\.[\w]{1,8}):(\d+)(?:-(\d+)|:(\d+))?\b/g;

export function tokenizeCitations(input: string): CitationToken[] {
  const tokens: CitationToken[] = [];
  let lastIndex = 0;
  for (const m of input.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) tokens.push({ kind: 'text', text: input.slice(lastIndex, start) });
    const startLine = Number(m[2] ?? '0');
    const rangeEnd = m[3] !== undefined ? Number(m[3]) : undefined;
    const token: CitationToken = {
      kind: 'citation',
      text: m[0],
      file: m[1] ?? '',
      line: startLine,
    };
    if (rangeEnd !== undefined && rangeEnd >= startLine) token.endLine = rangeEnd;
    tokens.push(token);
    lastIndex = start + m[0].length;
  }
  if (lastIndex < input.length) tokens.push({ kind: 'text', text: input.slice(lastIndex) });
  return tokens;
}
