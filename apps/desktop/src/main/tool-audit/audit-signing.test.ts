import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUNDLE_FORMAT,
  canonicalizeBundle,
  verifyAuditBundle,
} from '@opencodex/audit-verify';

// We exercise the same signing primitives the desktop module uses, without
// reaching into keychain/Electron settings. The contract is: a buffer signed
// with Ed25519 round-trips through verifyAuditBundle when the public half is
// embedded in the bundle.

describe('audit signing round-trip', () => {
  it('sign + verify a hand-built bundle succeeds', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = {
      format: AUDIT_BUNDLE_FORMAT,
      generatedAt: '2026-05-28T12:00:00.000Z',
      deviceId: 'unit-test-device',
      publicKey: publicKeyPem,
      entries: [
        {
          id: 'r-1',
          messageId: 'm-1',
          toolName: 'write_file',
          input: { file_path: 'a.ts', content: 'export const x = 1;' },
          output: { ok: true },
          decision: 'auto' as const,
          isError: false,
          durationMs: 12,
          createdAt: '2026-05-28T12:00:00.000Z',
          triggerSource: 'user' as const,
          runnerId: null,
        },
      ],
    };
    const payload = canonicalizeBundle(bundle);
    const signature = sign(null, payload, privateKey).toString('base64');

    expect(verify(null, payload, publicKey, Buffer.from(signature, 'base64'))).toBe(true);

    const result = verifyAuditBundle({ bundle, signature });
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBe(1);
  });

  it('detects tampered entry', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundle = {
      format: AUDIT_BUNDLE_FORMAT,
      generatedAt: '2026-05-28T12:00:00.000Z',
      deviceId: 'd',
      publicKey: publicKeyPem,
      entries: [
        {
          id: 'r-1',
          messageId: 'm-1',
          toolName: 'write_file',
          input: { content: 'safe' },
          output: { ok: true },
          decision: 'auto' as const,
          isError: false,
          durationMs: 1,
          createdAt: '2026-05-28T12:00:00.000Z',
          triggerSource: 'user' as const,
          runnerId: null,
        },
      ],
    };
    const signature = sign(null, canonicalizeBundle(bundle), privateKey).toString('base64');
    const tampered = {
      ...bundle,
      entries: [{ ...bundle.entries[0]!, input: { content: 'evil' } }],
    };
    expect(verifyAuditBundle({ bundle: tampered, signature }).ok).toBe(false);
  });
});
