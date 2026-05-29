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
    data[key] = decodeScalar(value);
  }
  return { data, body: raw.slice(match[0].length) };
}

export function renderFrontMatter(data: Record<string, string>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return '';
  const lines = keys.map((k) => `${encodeKey(k)}: ${encodeScalar(data[k] ?? '')}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function decodeScalar(s: string): string {
  if (s.length === 0) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if (s.length >= 2 && first === '"' && last === '"') {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && first === "'" && last === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function encodeScalar(v: string): string {
  if (v.length === 0) return '""';
  if (mustDoubleQuote(v)) return JSON.stringify(v);
  if (mustSingleQuote(v)) return `'${v.replace(/'/g, "''")}'`;
  return v;
}

function encodeKey(k: string): string {
  if (k.length === 0) return '""';
  if (/[:#\n\r"'\t]/.test(k) || /^\s|\s$/.test(k)) return JSON.stringify(k);
  return k;
}

function mustDoubleQuote(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) return true;
    if (c <= 8) return true;
    if (c === 11 || c === 12) return true;
    if (c >= 14 && c <= 31) return true;
  }
  if (v.includes('"') && v.includes("'")) return true;
  return false;
}

function mustSingleQuote(v: string): boolean {
  if (/^\s|\s$/.test(v)) return true;
  if (v.includes('"')) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(v)) return true;
  if (/^[-?:,[\]{}&*!|>%@`#]/.test(v)) return true;
  if (v.startsWith('---') || v.startsWith('...')) return true;
  if (/:\s/.test(v) || /\s#/.test(v)) return true;
  return false;
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
