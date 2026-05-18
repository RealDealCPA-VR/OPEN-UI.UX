import { spawn } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_IGNORE_DIRS } from './walk';
import type { GrepMatch } from './grep';

let availabilityCheck: Promise<boolean> | null = null;

export function isRipgrepAvailable(): Promise<boolean> {
  if (availabilityCheck) return availabilityCheck;
  availabilityCheck = new Promise((resolve) => {
    try {
      const child = spawn('rg', ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return availabilityCheck;
}

export function resetRipgrepAvailabilityCache(): void {
  availabilityCheck = null;
}

export interface RipgrepOptions {
  pattern: string;
  cwd: string;
  glob?: string;
  caseInsensitive?: boolean;
  maxMatches: number;
  fileSizeLimit: number;
  signal: AbortSignal;
}

export async function ripgrepSearch(opts: RipgrepOptions): Promise<GrepMatch[]> {
  const args = [
    '--json',
    '--no-messages',
    '--no-ignore',
    '--no-heading',
    `--max-filesize=${opts.fileSizeLimit}`,
  ];
  if (opts.caseInsensitive) args.push('--ignore-case');
  for (const dir of DEFAULT_IGNORE_DIRS) {
    args.push('--glob', `!${dir}`);
  }
  if (opts.glob) {
    args.push('--glob', opts.glob);
  }
  args.push('--regexp', opts.pattern, '.');

  return new Promise<GrepMatch[]>((resolve, reject) => {
    const child = spawn('rg', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: opts.signal,
    });

    const matches: GrepMatch[] = [];
    let buffer = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        const match = parseMatchLine(line);
        if (!match) continue;
        matches.push(match);
        if (matches.length >= opts.maxMatches) {
          settle(() => {
            child.kill();
            resolve(matches);
          });
          return;
        }
      }
    });

    child.stderr.resume();

    child.on('error', (err) => {
      settle(() => reject(err));
    });

    child.on('exit', (code) => {
      settle(() => {
        if (code === 0 || code === 1 || code === null) resolve(matches);
        else reject(new Error(`ripgrep exited with code ${code}`));
      });
    });
  });
}

function parseMatchLine(line: string): GrepMatch | null {
  let evt: unknown;
  try {
    evt = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof evt !== 'object' || evt === null) return null;
  const obj = evt as Record<string, unknown>;
  if (obj.type !== 'match') return null;
  const data = obj.data;
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const pathField = d.path as { text?: unknown } | undefined;
  const linesField = d.lines as { text?: unknown } | undefined;
  const lineNumber = d.line_number;
  if (typeof pathField?.text !== 'string') return null;
  if (typeof linesField?.text !== 'string') return null;
  if (typeof lineNumber !== 'number') return null;
  return {
    file: pathField.text.split(path.sep).join('/'),
    line: lineNumber,
    text: linesField.text.replace(/\r?\n$/, ''),
  };
}
