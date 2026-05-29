import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUNDLE_FORMAT,
  type AuditBundle,
  type AuditBundleEnvelope,
  canonicalizeBundle,
  parseEnvelope,
  verifyAuditBundle,
} from './index';

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function makeBundle(publicKey: string, overrides: Partial<AuditBundle> = {}): AuditBundle {
  return {
    format: AUDIT_BUNDLE_FORMAT,
    generatedAt: '2026-05-28T00:00:00.000Z',
    deviceId: 'device-abc',
    publicKey,
    entries: [
      {
        id: 'id-1',
        messageId: 'msg-1',
        toolName: 'read_file',
        input: { path: 'a.ts' },
        output: 'hello',
        decision: 'auto',
        isError: false,
        durationMs: 42,
        createdAt: '2026-05-28T00:00:00.000Z',
        triggerSource: 'user',
        runnerId: null,
      },
    ],
    ...overrides,
  };
}

describe('verifyAuditBundle', () => {
  it('accepts a valid signature', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const bundle = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
    const envelope: AuditBundleEnvelope = { bundle, signature };
    const result = verifyAuditBundle(envelope);
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBe(1);
    expect(result.deviceId).toBe('device-abc');
  });

  it('rejects a tampered bundle', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const bundle = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
    const tampered: AuditBundle = {
      ...bundle,
      entries: bundle.entries.map((e) => ({ ...e, output: 'goodbye' })),
    };
    const envelope: AuditBundleEnvelope = { bundle: tampered, signature };
    const result = verifyAuditBundle(envelope);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('rejects a bundle with a wrong-key override', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const { publicKeyPem: otherPub } = makeKeyPair();
    const bundle = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
    const envelope: AuditBundleEnvelope = { bundle, signature };
    const result = verifyAuditBundle(envelope, { publicKeyOverride: otherPub });
    expect(result.ok).toBe(false);
  });

  it('parseEnvelope round-trips', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const bundle = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
    const envelope: AuditBundleEnvelope = { bundle, signature };
    const json = JSON.stringify(envelope);
    const parsed = parseEnvelope(json);
    expect(parsed.bundle.deviceId).toBe('device-abc');
    expect(verifyAuditBundle(parsed).ok).toBe(true);
  });
});
