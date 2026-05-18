import { useState, type ReactNode } from 'react';
import { parseMarkdown, type Block } from './markdown-parse';

interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps): JSX.Element {
  const blocks = parseMarkdown(text);
  return (
    <div className="md">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }): JSX.Element {
  switch (block.kind) {
    case 'heading':
      return headingTag(block.level, renderInline(block.text));
    case 'paragraph':
      return <p>{renderInline(block.text)}</p>;
    case 'code':
      return <CodeBlock language={block.language} body={block.body} />;
    case 'list':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'blockquote':
      return <blockquote>{renderInline(block.text)}</blockquote>;
    case 'hr':
      return <hr />;
  }
}

function headingTag(level: number, children: ReactNode): JSX.Element {
  switch (level) {
    case 1:
      return <h1>{children}</h1>;
    case 2:
      return <h2>{children}</h2>;
    case 3:
      return <h3>{children}</h3>;
    case 4:
      return <h4>{children}</h4>;
    case 5:
      return <h5>{children}</h5>;
    default:
      return <h6>{children}</h6>;
  }
}

function CodeBlock({ language, body }: { language: string | null; body: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{language ?? 'text'}</span>
        <button type="button" className="md-code-copy" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{highlight(body, language)}</code>
      </pre>
    </div>
  );
}

interface Token {
  kind: 'keyword' | 'string' | 'number' | 'comment' | 'text';
  value: string;
}

const KEYWORDS: Record<string, ReadonlySet<string>> = {
  js: new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'from',
    'as',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'true',
    'false',
    'null',
    'undefined',
  ]),
  ts: new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'from',
    'as',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'true',
    'false',
    'null',
    'undefined',
    'interface',
    'type',
    'enum',
    'public',
    'private',
    'protected',
    'readonly',
    'implements',
    'satisfies',
  ]),
  py: new Set([
    'def',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'class',
    'import',
    'from',
    'as',
    'try',
    'except',
    'finally',
    'raise',
    'with',
    'lambda',
    'pass',
    'continue',
    'break',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'in',
    'is',
    'global',
    'nonlocal',
    'async',
    'await',
    'yield',
  ]),
  json: new Set(['true', 'false', 'null']),
  rust: new Set([
    'fn',
    'let',
    'mut',
    'const',
    'static',
    'struct',
    'enum',
    'trait',
    'impl',
    'pub',
    'use',
    'mod',
    'crate',
    'self',
    'super',
    'match',
    'if',
    'else',
    'for',
    'while',
    'loop',
    'return',
    'break',
    'continue',
    'true',
    'false',
    'async',
    'await',
    'move',
    'ref',
    'where',
    'as',
    'in',
  ]),
  go: new Set([
    'func',
    'var',
    'const',
    'type',
    'struct',
    'interface',
    'package',
    'import',
    'return',
    'if',
    'else',
    'for',
    'range',
    'switch',
    'case',
    'default',
    'break',
    'continue',
    'go',
    'defer',
    'chan',
    'map',
    'true',
    'false',
    'nil',
  ]),
};

const ALIASES: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  typescript: 'ts',
  tsx: 'ts',
  python: 'py',
  golang: 'go',
};

function tokenize(source: string, language: string | null): Token[] {
  if (!language) return [{ kind: 'text', value: source }];
  const langKey = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const keywords = KEYWORDS[langKey];
  if (!keywords) return [{ kind: 'text', value: source }];

  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;

    // line comments
    if (
      (langKey === 'py' && ch === '#') ||
      (langKey !== 'py' && ch === '/' && source[i + 1] === '/')
    ) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      tokens.push({ kind: 'comment', value: source.slice(i, stop) });
      i = stop;
      continue;
    }
    // block comments (C-like)
    if (langKey !== 'py' && ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      tokens.push({ kind: 'comment', value: source.slice(i, stop) });
      i = stop;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ kind: 'string', value: source.slice(i, j) });
      i = j;
      continue;
    }
    // numbers
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < source.length && /[0-9._a-fA-FxXoObBn]/.test(source[j] ?? '')) j += 1;
      tokens.push({ kind: 'number', value: source.slice(i, j) });
      i = j;
      continue;
    }
    // identifiers
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j] ?? '')) j += 1;
      const word = source.slice(i, j);
      tokens.push({ kind: keywords.has(word) ? 'keyword' : 'text', value: word });
      i = j;
      continue;
    }
    // anything else: accumulate until a special char
    let j = i + 1;
    while (j < source.length) {
      const c = source[j] ?? '';
      if (c === '"' || c === "'" || c === '`' || c === '/' || c === '#' || /[A-Za-z_$0-9]/.test(c))
        break;
      j += 1;
    }
    tokens.push({ kind: 'text', value: source.slice(i, j) });
    i = j;
  }
  return tokens;
}

function highlight(source: string, language: string | null): ReactNode {
  const tokens = tokenize(source, language);
  return tokens.map((t, i) => {
    if (t.kind === 'text') return t.value;
    return (
      <span key={i} className={`tok-${t.kind}`}>
        {t.value}
      </span>
    );
  });
}

function renderInline(text: string): ReactNode {
  return renderInlineRecursive(text, 0);
}

function renderInlineRecursive(text: string, keyOffset: number): ReactNode {
  const parts: ReactNode[] = [];
  let i = 0;
  let buffer = '';
  let counter = keyOffset;
  const flush = (): void => {
    if (buffer.length > 0) {
      parts.push(buffer);
      buffer = '';
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      buffer += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        parts.push(<code key={`c-${counter++}`}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        parts.push(
          <strong key={`b-${counter++}`}>
            {renderInlineRecursive(text.slice(i + 2, end), counter * 1000)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] !== ch) {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        parts.push(
          <em key={`i-${counter++}`}>
            {renderInlineRecursive(text.slice(i + 1, end), counter * 1000)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const label = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen);
          flush();
          parts.push(
            <a key={`l-${counter++}`} href={href} target="_blank" rel="noreferrer">
              {label}
            </a>,
          );
          i = closeParen + 1;
          continue;
        }
      }
    }
    buffer += ch ?? '';
    i += 1;
  }
  flush();
  return parts;
}
