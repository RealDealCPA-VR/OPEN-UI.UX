import { describe, expect, it } from 'vitest';
import { ManifestSchema, PermissionSchema } from './manifest';

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'example-plugin',
    version: '1.0.0',
    displayName: 'Example Plugin',
    entry: 'dist/index.js',
    engines: { opencodex: '^0.1.0' },
    ...overrides,
  };
}

describe('ManifestSchema contributions.runners', () => {
  it('accepts a valid runner entry', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        contributions: {
          runners: [{ id: 'claude-code', displayName: 'Claude Code' }],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts multiple valid runner entries', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        contributions: {
          runners: [
            { id: 'claude-code', displayName: 'Claude Code' },
            { id: 'codex-cli', displayName: 'Codex CLI' },
          ],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an empty id', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        contributions: {
          runners: [{ id: '', displayName: 'Claude Code' }],
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a missing displayName', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        contributions: {
          runners: [{ id: 'claude-code' }],
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty displayName', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        contributions: {
          runners: [{ id: 'claude-code', displayName: '' }],
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('treats runners as optional', () => {
    const result = ManifestSchema.safeParse(baseManifest({ contributions: {} }));
    expect(result.success).toBe(true);
  });

  it('treats the entire contributions block as optional', () => {
    const result = ManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
  });
});

describe('PermissionSchema agent.runner', () => {
  it('accepts agent.runner as a permission value', () => {
    const result = PermissionSchema.safeParse('agent.runner');
    expect(result.success).toBe(true);
  });

  it('accepts agent.runner alongside existing permissions in a manifest', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        permissions: ['workspace.read', 'agent.runner', 'ui.panel'],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an unknown permission value', () => {
    const result = PermissionSchema.safeParse('agent.unknown');
    expect(result.success).toBe(false);
  });

  it('rejects a manifest containing an unknown permission', () => {
    const result = ManifestSchema.safeParse(
      baseManifest({
        permissions: ['agent.bogus'],
      }),
    );
    expect(result.success).toBe(false);
  });
});
