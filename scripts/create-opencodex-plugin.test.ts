import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../packages/plugin-sdk/src/manifest';

function runScaffold(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'opencodex-scaffold-'));
  const script = resolve(__dirname, 'create-opencodex-plugin.mjs');
  execFileSync('node', [script, name, '-y'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('create-opencodex-plugin scaffold', () => {
  it('emits a manifest that validates against ManifestSchema', () => {
    const dir = runScaffold('my-scaffold');
    try {
      const manifestPath = join(dir, 'my-scaffold', 'opencodex.plugin.json');
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const parsed = ManifestSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults permissions to [] so authors opt in explicitly', () => {
    const dir = runScaffold('perm-scaffold');
    try {
      const manifestPath = join(dir, 'perm-scaffold', 'opencodex.plugin.json');
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(raw.permissions).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits a SubagentRunner whose run is an async generator yielding ChatEvents', () => {
    const dir = runScaffold('runner-scaffold');
    try {
      const src = readFileSync(join(dir, 'runner-scaffold', 'src', 'index.ts'), 'utf8');
      expect(src).toMatch(/async function\* runRunnerScaffold\(opts: SubagentRunOptions\)/);
      expect(src).toMatch(/AsyncIterable<ChatEvent>/);
      expect(src).toMatch(/yield \{ type: 'done', stopReason: 'end_turn' \}/);
      expect(src).not.toMatch(/kind: 'final-text'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('panel.html ships a strict CSP meta tag', () => {
    const dir = runScaffold('panel-scaffold');
    try {
      const html = readFileSync(join(dir, 'panel-scaffold', 'panel.html'), 'utf8');
      expect(html).toMatch(/Content-Security-Policy/);
      expect(html).toMatch(/default-src 'none'/);
      expect(html).toMatch(/script-src 'none'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pins @opencodex/core to workspace:* when scaffolded inside the monorepo', () => {
    const dir = runScaffold('pin-scaffold');
    try {
      const pkgPath = join(dir, 'pin-scaffold', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      expect(pkg.dependencies['@opencodex/core']).not.toBe('^0.1.0');
      expect(pkg.dependencies['@opencodex/plugin-sdk']).not.toBe('^0.1.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
