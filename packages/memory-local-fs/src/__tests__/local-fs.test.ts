import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalFsMemory,
  bm25Search,
  tokenize,
  parseSections,
  clipForPrompt,
  DEFAULT_MAX_PREPEND_BYTES,
} from '../index';

interface Tmp {
  root: string;
  cleanup(): Promise<void>;
}

async function makeWorkspace(seed?: string): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-local-fs-test-'));
  if (seed !== undefined) {
    const memDir = path.join(root, '.opencodex');
    await fs.mkdir(memDir, { recursive: true });
    await fs.writeFile(path.join(memDir, 'memory.md'), seed, 'utf8');
  }
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe('tokenize + bm25', () => {
  it('tokenizes lowercase words', () => {
    expect(tokenize('Hello, World 42!')).toEqual(['hello', 'world', '42']);
  });

  it('ranks docs containing more query terms higher', () => {
    const docs = [
      { id: 'a', tokens: tokenize('apple banana cherry') },
      { id: 'b', tokens: tokenize('apple apple banana') },
      { id: 'c', tokens: tokenize('durian only here') },
    ];
    const hits = bm25Search('apple', docs);
    expect(hits[0]?.id).toBe('b');
    expect(hits.find((h) => h.id === 'c')).toBeUndefined();
  });

  it('returns empty for empty query or docs', () => {
    expect(bm25Search('', [{ id: 'x', tokens: ['y'] }])).toEqual([]);
    expect(bm25Search('hi', [])).toEqual([]);
  });
});

describe('parseSections', () => {
  it('splits on heading boundaries', () => {
    const raw = `## One\nbody one\n\n## Two\nbody two\n\n### Two-A\nnested body`;
    const sections = parseSections(raw);
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Two', 'Two-A']);
    expect(sections[0]?.body.trim()).toBe('body one');
    expect(sections[2]?.level).toBe(3);
  });

  it('captures preamble before first heading as (intro)', () => {
    const raw = `hello preamble\n\n## After\nstuff`;
    const sections = parseSections(raw);
    expect(sections[0]?.heading).toBe('(intro)');
    expect(sections[1]?.heading).toBe('After');
  });

  it('returns empty array for empty input', () => {
    expect(parseSections('')).toEqual([]);
  });

  it('ignores heading-shaped lines inside fenced code blocks', () => {
    const raw = [
      '## Real',
      'pre',
      '',
      '```',
      '## Fake heading inside code',
      'more code',
      '```',
      '',
      '## After fence',
      'tail',
    ].join('\n');
    const sections = parseSections(raw);
    expect(sections.map((s) => s.heading)).toEqual(['Real', 'After fence']);
    expect(sections[0]?.body).toContain('## Fake heading inside code');
    expect(sections[0]?.body).toContain('more code');
  });

  it('handles tilde-fenced code blocks', () => {
    const raw = ['## A', '~~~', '## not a heading', '~~~', '## B', 'body'].join('\n');
    const sections = parseSections(raw);
    expect(sections.map((s) => s.heading)).toEqual(['A', 'B']);
  });
});

describe('LocalFsMemory.testConnection', () => {
  let tmp: Tmp;
  afterEach(async () => {
    if (tmp) await tmp.cleanup();
  });

  it('reports ok when no file exists yet (empty memory)', async () => {
    tmp = await makeWorkspace();
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    const result = await mem.testConnection();
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(0);
    expect(result.sectionCount).toBe(0);
  });

  it('reports the section count after seeding', async () => {
    tmp = await makeWorkspace('## Alpha\nx\n\n## Beta\ny');
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    const result = await mem.testConnection();
    expect(result.ok).toBe(true);
    expect(result.sectionCount).toBe(2);
    expect(result.bytes).toBeGreaterThan(0);
  });
});

describe('LocalFsMemory.search', () => {
  let tmp: Tmp;
  let mem: LocalFsMemory;

  beforeEach(async () => {
    tmp = await makeWorkspace(
      [
        '## Build commands',
        'Run `pnpm build` to compile every package in the monorepo.',
        '',
        '## Conventions',
        'TypeScript strict, no any, ESM everywhere, kebab-case files.',
        '',
        '## Provider quirks',
        'Anthropic prompts cache by default; OpenAI charges separately.',
      ].join('\n'),
    );
    mem = new LocalFsMemory({ workspaceRoot: tmp.root });
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('ranks sections by BM25 over heading + body', async () => {
    const hits = await mem.search('typescript conventions kebab', 5);
    expect(hits[0]?.heading).toBe('Conventions');
    expect(hits[0]?.snippet).toMatch(/kebab-case|TypeScript/i);
  });

  it('returns at most `limit` hits', async () => {
    const hits = await mem.search('pnpm build', 1);
    expect(hits.length).toBe(1);
    expect(hits[0]?.heading).toBe('Build commands');
  });

  it('returns empty array when nothing matches', async () => {
    const hits = await mem.search('zzznevermatches', 5);
    expect(hits).toEqual([]);
  });
});

describe('LocalFsMemory.append (atomic)', () => {
  let tmp: Tmp;
  afterEach(async () => {
    if (tmp) await tmp.cleanup();
  });

  it('appends content under an existing section without breaking neighbours', async () => {
    tmp = await makeWorkspace('## Alpha\nfirst alpha line\n\n## Beta\nbeta body');
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    const result = await mem.append('Alpha', 'extra alpha note');
    expect(result.appendedSection).toBe('Alpha');
    expect(result.bytesWritten).toBeGreaterThan(0);
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    expect(after).toMatch(/## Alpha[\s\S]*first alpha line[\s\S]*extra alpha note[\s\S]*## Beta/);
    expect(after).toMatch(/beta body/);
  });

  it('creates a new level-2 section when heading does not exist', async () => {
    tmp = await makeWorkspace('## Alpha\nbody');
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await mem.append('New Topic', 'fresh content');
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    expect(after).toMatch(/## Alpha/);
    expect(after).toMatch(/## New Topic\n\nfresh content/);
  });

  it('creates the memory file (and directory) when the file does not yet exist', async () => {
    tmp = await makeWorkspace();
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await mem.append('Seeded', 'first ever entry');
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    expect(after).toMatch(/## Seeded\n\nfirst ever entry/);
  });

  it('does not leave a .tmp sibling after a successful write', async () => {
    tmp = await makeWorkspace();
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await mem.append('A', 'hi');
    const dir = path.dirname(mem.memoryPath);
    const entries = await fs.readdir(dir);
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('preserves CRLF line endings when the source file uses them', async () => {
    const crlfSeed = ['## Alpha', 'first line', '', '## Beta', 'beta body'].join('\r\n');
    tmp = await makeWorkspace(crlfSeed);
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await mem.append('Alpha', 'added');
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    expect(after.includes('\r\n')).toBe(true);
    expect(/(^|[^\r])\n/.test(after)).toBe(false);
    expect(after).toMatch(/added/);
  });

  it('uses LF when the source file uses LF', async () => {
    const lfSeed = ['## Alpha', 'first', '', '## Beta', 'b'].join('\n');
    tmp = await makeWorkspace(lfSeed);
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await mem.append('Alpha', 'added');
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    expect(after.includes('\r\n')).toBe(false);
  });

  it('serializes concurrent appends to the same file', async () => {
    tmp = await makeWorkspace();
    const mem = new LocalFsMemory({ workspaceRoot: tmp.root });
    await Promise.all(Array.from({ length: 8 }, (_, i) => mem.append('Bench', `entry ${i}`)));
    const after = await fs.readFile(mem.memoryPath, 'utf8');
    for (let i = 0; i < 8; i++) {
      expect(after).toContain(`entry ${i}`);
    }
  });
});

describe('clipForPrompt', () => {
  it('returns input verbatim when under the byte cap', () => {
    expect(clipForPrompt('short', 4096)).toBe('short');
  });

  it('truncates at the cap and adds a marker', () => {
    const big = 'x'.repeat(DEFAULT_MAX_PREPEND_BYTES + 200);
    const out = clipForPrompt(big);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_PREPEND_BYTES + 80);
    expect(out).toMatch(/memory\.md truncated/);
  });

  it('returns empty string when cap is zero', () => {
    expect(clipForPrompt('anything', 0)).toBe('');
  });
});
