export interface MemorySection {
  heading: string;
  level: number;
  body: string;
  startLine: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function parseSections(raw: string): MemorySection[] {
  const lines = raw.split(/\r?\n/);
  const sections: MemorySection[] = [];
  let current: MemorySection | null = null;
  let preambleBuffer: string[] = [];

  const flush = (): void => {
    if (current) {
      current.body = current.body.replace(/\s+$/, '');
      sections.push(current);
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = HEADING_RE.exec(line);
    if (match) {
      if (current === null && preambleBuffer.length > 0) {
        const body = preambleBuffer.join('\n').replace(/\s+$/, '');
        if (body.length > 0) {
          sections.push({ heading: '(intro)', level: 0, body, startLine: 0 });
        }
        preambleBuffer = [];
      }
      flush();
      current = {
        heading: (match[2] ?? '').trim(),
        level: (match[1] ?? '#').length,
        body: '',
        startLine: i,
      };
      continue;
    }
    if (current) {
      current.body += (current.body.length === 0 ? '' : '\n') + line;
    } else {
      preambleBuffer.push(line);
    }
  }
  if (current === null && preambleBuffer.length > 0) {
    const body = preambleBuffer.join('\n').replace(/\s+$/, '');
    if (body.length > 0) {
      sections.push({ heading: '(intro)', level: 0, body, startLine: 0 });
    }
  }
  flush();
  return sections;
}

export function sectionId(section: MemorySection, index: number): string {
  const slug = section.heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${index}:${slug || 'section'}`;
}
