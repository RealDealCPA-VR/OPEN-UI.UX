import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — sibling .mjs has no type declarations, only runtime exports.
import { scanText, scanDirectory } from './check-placeholders.mjs';

interface Hit {
  rel: string;
  lineNumber: number;
  line: string;
  pattern: string;
}

describe('check-placeholders scanText', () => {
  it('flags @TODO- prefix tokens', () => {
    const hits = scanText('release version @TODO-bump-me\n', 'README.md') as Hit[];
    expect(hits.length).toBe(1);
    expect(hits[0]?.lineNumber).toBe(1);
  });

  it('flags lorem ipsum case-insensitively', () => {
    const hits = scanText('LOREM   IPSUM dolor sit amet\n', 'docs/intro.md') as Hit[];
    expect(hits.length).toBe(1);
  });

  it('flags the xxx-xxx-xxx phone placeholder', () => {
    const hits = scanText('Call us at 555-XXX-XXX-XXX\n', 'docs/contact.md') as Hit[];
    expect(hits.length).toBe(1);
  });

  it('flags TODO: in *.md files', () => {
    const hits = scanText('Feature plan\n\n- TODO: write the rest\n', 'docs/plan.md') as Hit[];
    expect(hits.length).toBe(1);
    expect(hits[0]?.lineNumber).toBe(3);
  });

  it('flags FIXME: in *.md files', () => {
    const hits = scanText('FIXME: broken link below\n', 'docs/notes.md') as Hit[];
    expect(hits.length).toBe(1);
  });

  it('does NOT flag TODO: in *.ts source files', () => {
    const hits = scanText('// TODO: refactor\nexport const x = 1;\n', 'packages/foo/src/x.ts');
    expect(hits).toEqual([]);
  });

  it('does NOT flag clean docs', () => {
    const hits = scanText('# Heading\n\nNormal copy here.\n', 'README.md');
    expect(hits).toEqual([]);
  });
});

describe('check-placeholders scanDirectory', () => {
  it('respects the size cap and ignored directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'placeholder-test-'));
    try {
      mkdirSync(join(root, 'node_modules'));
      writeFileSync(join(root, 'node_modules', 'evil.md'), 'lorem ipsum');
      writeFileSync(join(root, 'good.md'), '# All good');
      writeFileSync(join(root, 'bad.md'), 'lorem ipsum somewhere');

      const hits = scanDirectory(root) as Hit[];
      const relPaths = hits.map((h) => h.rel.replace(/\\/g, '/'));
      expect(relPaths).toContain('bad.md');
      expect(relPaths).not.toContain('node_modules/evil.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors the allowlist for Todo.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'placeholder-test-'));
    try {
      writeFileSync(join(root, 'Todo.md'), 'TODO: this should be ignored\n');
      const hits = scanDirectory(root);
      expect(hits).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
