export interface ParsedFrontMatter {
  data: Record<string, string>;
  body: string;
}

const FENCE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/;

export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const match = FENCE.exec(raw);
  if (!match) return { data: {}, body: raw };
  const block = match[1] ?? '';
  const data: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key.length === 0) continue;
    data[key] = stripQuotes(value);
  }
  return { data, body: raw.slice(match[0].length) };
}

export function renderFrontMatter(data: Record<string, string>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return '';
  const lines = keys.map((k) => `${k}: ${escapeValue(data[k] ?? '')}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function escapeValue(v: string): string {
  if (/[:#\n]/.test(v)) return JSON.stringify(v);
  return v;
}

export function deriveTitle(
  frontData: Record<string, string>,
  body: string,
  fallback: string,
): string {
  const fmTitle = frontData['title'];
  if (typeof fmTitle === 'string' && fmTitle.length > 0) return fmTitle;
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) return trimmed.slice(2).trim();
    if (trimmed.length > 0 && !trimmed.startsWith('---')) break;
  }
  return fallback;
}
