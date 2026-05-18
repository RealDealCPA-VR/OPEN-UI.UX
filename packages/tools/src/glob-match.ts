export function globToRegExp(pattern: string): RegExp {
  const expanded = expandBraces(pattern);
  const alternatives = expanded.map((p) => globPartToRegex(p));
  return new RegExp(`^(?:${alternatives.join('|')})$`);
}

function globPartToRegex(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (c && /[.+^$|()[\]\\]/.test(c)) {
      out += `\\${c}`;
      i += 1;
      continue;
    }
    out += c ?? '';
    i += 1;
  }
  return out;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start === -1) return [pattern];
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++;
    else if (pattern[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [pattern];
  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  const inner = pattern.slice(start + 1, end);
  const parts = splitTopLevel(inner, ',');
  const tailExpansions = expandBraces(tail);
  const out: string[] = [];
  for (const part of parts) {
    for (const partExp of expandBraces(part)) {
      for (const tailExp of tailExpansions) {
        out.push(head + partExp + tailExp);
      }
    }
  }
  return out;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}
