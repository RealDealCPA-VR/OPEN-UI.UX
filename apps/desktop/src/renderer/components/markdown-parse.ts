export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language: string | null; body: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'hr' };

export function slugifyHeading(text: string): string {
  return text
    .replace(/`[^`]*`/g, '')
    .replace(/[*_~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1] && fence[1].length > 0 ? fence[1] : null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', language, body: body.join('\n') });
      continue;
    }

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = (heading[2] ?? '').trim();
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text,
        id: slugifyHeading(text),
      });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'blockquote', text: buf.join(' ') });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim().length > 0 &&
      !/^```/.test(lines[i] ?? '') &&
      !/^#{1,6}\s+/.test(lines[i] ?? '') &&
      !/^>\s?/.test(lines[i] ?? '') &&
      !/^[-*+]\s+/.test(lines[i] ?? '')
    ) {
      paragraphLines.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
  }
  return blocks;
}
