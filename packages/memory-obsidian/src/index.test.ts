import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObsidianMemory } from './index';
import { VaultPathError } from './path-guard';
import { bm25Search, tokenize } from './bm25';
import { parseFrontMatter, renderFrontMatter, deriveTitle } from './front-matter';

interface Tmp {
  root: string;
  cleanup(): Promise<void>;
}

async function makeVault(files: Record<string, string>): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-obs-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe('parseFrontMatter', () => {
  it('extracts simple keys', () => {
    const { data, body } = parseFrontMatter('---\ntitle: Hello\ntag: x\n---\nbody text');
    expect(data['title']).toBe('Hello');
    expect(data['tag']).toBe('x');
    expect(body).toBe('body text');
  });
  it('returns empty when no front matter', () => {
    const { data, body } = parseFrontMatter('# hi\nbody');
    expect(data).toEqual({});
    expect(body).toBe('# hi\nbody');
  });
});

describe('deriveTitle', () => {
  it('uses front matter title when present', () => {
    expect(deriveTitle({ title: 'A' }, '# B', 'fallback')).toBe('A');
  });
  it('uses first H1 when no front matter title', () => {
    expect(deriveTitle({}, '# My note\n\nbody', 'fallback')).toBe('My note');
  });
  it('falls back to file name', () => {
    expect(deriveTitle({}, 'body only', 'fname')).toBe('fname');
  });
});

describe('renderFrontMatter', () => {
  it('renders fence', () => {
    expect(renderFrontMatter({ title: 'A', tag: 'b' })).toBe('---\ntitle: A\ntag: b\n---\n');
  });
  it('returns empty when no keys', () => {
    expect(renderFrontMatter({})).toBe('');
  });
});

describe('tokenize + bm25', () => {
  it('tokenizes lowercase words', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });
  it('ranks docs containing more query terms higher', () => {
    const docs = [
      { id: 'a', tokens: tokenize('apple banana cherry') },
      { id: 'b', tokens: tokenize('apple apple banana') },
      { id: 'c', tokens: tokenize('durian') },
    ];
    const hits = bm25Search('apple', docs);
    expect(hits[0]?.id).toBe('b');
    expect(hits.find((h) => h.id === 'c')).toBeUndefined();
  });
});

describe('ObsidianMemory', () => {
  let tmp: Tmp;
  let mem: ObsidianMemory;

  beforeEach(async () => {
    tmp = await makeVault({
      'daily/today.md': '---\ntitle: Today\n---\nApple banana cherry. Today I learned a lot.',
      'projects/alpha.md': '# Alpha project\n\nApple apple banana. Working on alpha.',
      'random.md': '# Random\n\nDurian and other things.',
      'README.md': '# README\n\nNothing special here.',
    });
    mem = new ObsidianMemory({ vaultPath: tmp.root });
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('testConnection reports note count', async () => {
    const r = await mem.testConnection();
    expect(r.ok).toBe(true);
    expect(r.noteCount).toBe(4);
  });

  it('search ranks the most relevant note first', async () => {
    const results = await mem.search('apple', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path === 'projects/alpha.md' || results[0]?.path === 'daily/today.md').toBe(
      true,
    );
    for (const r of results) {
      expect(r.snippet.length).toBeGreaterThan(0);
    }
  });

  it('search excludes notes without query terms', async () => {
    const results = await mem.search('apple', 5);
    expect(results.find((r) => r.path === 'README.md')).toBeUndefined();
  });

  it('readNote returns body and front matter', async () => {
    const r = await mem.readNote('daily/today.md');
    expect(r.title).toBe('Today');
    expect(r.frontMatter['title']).toBe('Today');
    expect(r.content).toContain('Apple banana cherry');
  });

  it('readNote rejects path traversal', async () => {
    await expect(mem.readNote('../etc/passwd.md')).rejects.toBeInstanceOf(VaultPathError);
  });

  it('readNote rejects absolute paths', async () => {
    await expect(mem.readNote(path.resolve(tmp.root, 'daily/today.md'))).rejects.toBeInstanceOf(
      VaultPathError,
    );
  });

  it('appendNote appends content', async () => {
    await mem.appendNote('daily/today.md', 'Extra paragraph.');
    const raw = await fs.readFile(path.join(tmp.root, 'daily/today.md'), 'utf8');
    expect(raw).toContain('Extra paragraph.');
  });

  it('appendNote errors when file does not exist', async () => {
    await expect(mem.appendNote('does/not/exist.md', 'x')).rejects.toThrow(/not found/i);
  });

  it('createNote creates a new file with front matter', async () => {
    await mem.createNote('ideas/new.md', 'New Idea', 'body of note', { tag: 'cool' });
    const raw = await fs.readFile(path.join(tmp.root, 'ideas/new.md'), 'utf8');
    expect(raw).toContain('title: New Idea');
    expect(raw).toContain('tag: cool');
    expect(raw).toContain('body of note');
  });

  it('createNote errors if the file exists', async () => {
    await expect(mem.createNote('random.md', 't', 'b', {})).rejects.toThrow(/already exists/);
  });

  it('createNote adds .md extension if missing', async () => {
    await mem.createNote('ideas/extless', 'X', 'body', {});
    const stat = await fs.stat(path.join(tmp.root, 'ideas/extless.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('buildTools returns four tools with correct tiers', () => {
    const tools = mem.buildTools();
    expect(tools.map((t) => t.name)).toEqual([
      'memory__obsidian__memory_search',
      'memory__obsidian__memory_read',
      'memory__obsidian__memory_append',
      'memory__obsidian__memory_create_note',
    ]);
    expect(tools[0]?.permissionTier).toBe('read');
    expect(tools[1]?.permissionTier).toBe('read');
    expect(tools[2]?.permissionTier).toBe('write');
    expect(tools[3]?.permissionTier).toBe('write');
  });
});
