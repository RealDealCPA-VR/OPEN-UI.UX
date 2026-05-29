import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, type PluginManifest } from './manifest';
import { canonicalizeManifest, signManifest, verifyManifest, type TrustedKey } from './signing';

function makeKeypair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return ManifestSchema.parse({
    name: 'sig-test',
    version: '1.0.0',
    displayName: 'Signature Test',
    entry: 'dist/index.js',
    engines: { opencodex: '^0.1.0' },
    ...overrides,
  });
}

describe('plugin signing', () => {
  it('signs and verifies a manifest round-trip', () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = makeManifest();
    const sig = signManifest(manifest, privateKey);
    expect(sig.length).toBeGreaterThan(0);
    const trusted: TrustedKey[] = [{ id: 'opencodex-official', publicKey }];
    const result = verifyManifest(manifest, sig, trusted);
    expect(result.ok).toBe(true);
    expect(result.signer).toBe('opencodex-official');
  });

  it('detects tampered manifest fields', () => {
    const { privateKey, publicKey } = makeKeypair();
    const original = makeManifest();
    const sig = signManifest(original, privateKey);
    const tampered = makeManifest({ version: '9.9.9' });
    const result = verifyManifest(tampered, sig, [{ id: 'opencodex-official', publicKey }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no trusted key matched/);
  });

  it('rejects when no trusted keys are configured', () => {
    const { privateKey } = makeKeypair();
    const manifest = makeManifest();
    const sig = signManifest(manifest, privateKey);
    const result = verifyManifest(manifest, sig, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no trusted keys/);
  });

  it('rejects an empty signature string', () => {
    const { publicKey } = makeKeypair();
    const manifest = makeManifest();
    const result = verifyManifest(manifest, '', [{ id: 'k', publicKey }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing signature/);
  });

  it('rejects a signature from a non-trusted key', () => {
    const attacker = makeKeypair();
    const official = makeKeypair();
    const manifest = makeManifest();
    const sig = signManifest(manifest, attacker.privateKey);
    const result = verifyManifest(manifest, sig, [
      { id: 'official', publicKey: official.publicKey },
    ]);
    expect(result.ok).toBe(false);
  });

  it('canonicalizes manifests deterministically regardless of key order', () => {
    const a = makeManifest({ description: 'a', author: 'x' });
    const b = makeManifest({ author: 'x', description: 'a' });
    expect(canonicalizeManifest(a)).toBe(canonicalizeManifest(b));
  });
});
