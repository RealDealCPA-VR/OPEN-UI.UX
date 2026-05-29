import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../packages/plugin-sdk/src/manifest';

describe('create-opencodex-plugin scaffold', () => {
  it('emits a manifest that validates against ManifestSchema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencodex-scaffold-'));
    try {
      const script = resolve(__dirname, 'create-opencodex-plugin.mjs');
      execFileSync('node', [script, 'my-scaffold', '-y'], { cwd: dir, stdio: 'pipe' });
      const manifestPath = join(dir, 'my-scaffold', 'opencodex.plugin.json');
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const parsed = ManifestSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
