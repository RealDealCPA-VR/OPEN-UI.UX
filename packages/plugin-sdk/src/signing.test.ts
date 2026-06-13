import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManifestSchema, type PluginManifest } from './manifest';
import {
  LEGACY_SIGNATURE_ENVELOPE_VERSION,
  SIGNATURE_ENVELOPE_VERSION,
  buildIntegrityPayload,
  canonicalizeManifest,
  collectIntegrityFilePaths,
  hashPluginFiles,
  signManifest,
  signManifestEnvelope,
  signPluginDirectory,
  signPluginEnvelope,
  verifyManifest,
  verifyPluginIntegrity,
  type TrustedKey,
} from './signing';

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

describe('plugin signing (legacy manifest-only)', () => {
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

  it('signManifestEnvelope tags the envelope with the legacy version and embeds the payload', () => {
    const { privateKey } = makeKeypair();
    const manifest = makeManifest();
    const envelope = signManifestEnvelope(manifest, privateKey);
    expect(envelope.v).toBe(LEGACY_SIGNATURE_ENVELOPE_VERSION);
    expect(envelope.payload).toBe(canonicalizeManifest(manifest));
    expect(envelope.sig.length).toBeGreaterThan(0);
  });

  it('verifyManifest accepts a JSON v1 envelope sig string', () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = makeManifest();
    const envelope = signManifestEnvelope(manifest, privateKey);
    const result = verifyManifest(manifest, JSON.stringify(envelope), [{ id: 'k', publicKey }]);
    expect(result.ok).toBe(true);
    expect(result.signer).toBe('k');
  });

  it('verifyManifest refuses v2 envelopes (integrity-only path)', () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = makeManifest();
    const envelope = signPluginEnvelope(manifest, [], privateKey);
    const result = verifyManifest(manifest, JSON.stringify(envelope), [{ id: 'k', publicKey }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verifyPluginIntegrity/);
  });

  it('rejects an envelope tagged with an unknown version', () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = makeManifest();
    const envelope = signManifestEnvelope(manifest, privateKey);
    const bad = JSON.stringify({ ...envelope, v: 99 });
    const result = verifyManifest(manifest, bad, [{ id: 'k', publicKey }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported signature envelope/);
  });
});

describe('plugin integrity (v2 envelope with file hashes)', () => {
  let dir = '';

  function manifestWithContributions(): PluginManifest {
    return makeManifest({
      entry: 'index.mjs',
      contributions: {
        panels: [{ id: 'main', title: 'Main', entry: 'panel.html' }],
        slashCommands: [{ name: 'hello', entry: 'commands/hello.mjs' }],
      },
    });
  }

  function writeFixtureFiles(): PluginManifest {
    const manifest = manifestWithContributions();
    writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() {} };\n');
    writeFileSync(join(dir, 'panel.html'), '<!doctype html><body>hi</body>\n');
    const cmdDir = join(dir, 'commands');
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, 'hello.mjs'), 'export default {};\n');
    return manifest;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sdk-signing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('collects entry, panel, and slash-command paths in deterministic sorted order', () => {
    const manifest = manifestWithContributions();
    expect(collectIntegrityFilePaths(manifest)).toEqual([
      'commands/hello.mjs',
      'index.mjs',
      'panel.html',
    ]);
  });

  it('builds the same payload regardless of file ordering', () => {
    const manifest = makeManifest();
    const a = buildIntegrityPayload(manifest, [
      { path: 'b.js', sha256: 'b'.repeat(64) },
      { path: 'a.js', sha256: 'a'.repeat(64) },
    ]);
    const b = buildIntegrityPayload(manifest, [
      { path: 'a.js', sha256: 'a'.repeat(64) },
      { path: 'b.js', sha256: 'b'.repeat(64) },
    ]);
    expect(a).toBe(b);
  });

  it('signs a plugin directory and verifies it end to end', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const envelope = await signPluginDirectory(dir, manifest, privateKey);
    expect(envelope.v).toBe(SIGNATURE_ENVELOPE_VERSION);
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      manifest,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey }],
      actual,
    );
    expect(result).toEqual({ status: 'signed', signer: 'official' });
  });

  it('flags a tampered entry file', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const envelope = await signPluginDirectory(dir, manifest, privateKey);
    writeFileSync(join(dir, 'index.mjs'), 'export default { async activate() { /* evil */ } };\n');
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      manifest,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey }],
      actual,
    );
    expect(result.status).toBe('tampered');
    expect(result.status === 'tampered' && result.reason).toMatch(/hash mismatch: index\.mjs/);
  });

  it('flags a missing-on-disk entry file as tampered', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const envelope = await signPluginDirectory(dir, manifest, privateKey);
    rmSync(join(dir, 'panel.html'));
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      manifest,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey }],
      actual,
    );
    expect(result.status).toBe('tampered');
    expect(result.status === 'tampered' && result.reason).toMatch(/missing on disk: panel\.html/);
  });

  it('fails closed when the signed envelope lacks coverage for a referenced file', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const partial = (await hashPluginFiles(dir, manifest)).filter((f) => f.path !== 'panel.html');
    const envelope = signPluginEnvelope(manifest, partial, privateKey);
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      manifest,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey }],
      actual,
    );
    expect(result.status).toBe('tampered');
    expect(result.status === 'tampered' && result.reason).toMatch(/no signed hash: panel\.html/);
  });

  it('fails closed on a trusted legacy manifest-only signature (no hash coverage)', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const sig = signManifest(manifest, privateKey);
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(manifest, sig, [{ id: 'official', publicKey }], actual);
    expect(result.status).toBe('tampered');
    expect(result.status === 'tampered' && result.reason).toMatch(/legacy manifest-only/);
  });

  it('flags a manifest that diverges from the signed payload', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = writeFixtureFiles();
    const envelope = await signPluginDirectory(dir, manifest, privateKey);
    const swapped = ManifestSchema.parse({ ...manifest, permissions: ['shell.execute'] });
    const actual = await hashPluginFiles(dir, swapped, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      swapped,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey }],
      actual,
    );
    expect(result.status).toBe('tampered');
    expect(result.status === 'tampered' && result.reason).toMatch(/manifest does not match/);
  });

  it('reports untrusted for signatures from unknown keys (sideload path stays open)', async () => {
    const attacker = makeKeypair();
    const official = makeKeypair();
    const manifest = writeFixtureFiles();
    const envelope = await signPluginDirectory(dir, manifest, attacker.privateKey);
    const actual = await hashPluginFiles(dir, manifest, { ignoreMissing: true });
    const result = verifyPluginIntegrity(
      manifest,
      JSON.stringify(envelope),
      [{ id: 'official', publicKey: official.publicKey }],
      actual,
    );
    expect(result.status).toBe('untrusted');
  });

  it('reports unsigned for an empty signature', () => {
    const { publicKey } = makeKeypair();
    const manifest = makeManifest();
    const result = verifyPluginIntegrity(manifest, '   ', [{ id: 'k', publicKey }], []);
    expect(result.status).toBe('unsigned');
  });

  it('hashPluginFiles throws on missing files unless ignoreMissing is set', async () => {
    const manifest = manifestWithContributions();
    await expect(hashPluginFiles(dir, manifest)).rejects.toThrow(/cannot hash plugin file/);
    await expect(hashPluginFiles(dir, manifest, { ignoreMissing: true })).resolves.toEqual([]);
  });
});
