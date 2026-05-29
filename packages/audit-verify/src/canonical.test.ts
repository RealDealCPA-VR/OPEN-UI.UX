import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalJsonBytes } from './canonical';
import {
  AUDIT_BUNDLE_FORMAT,
  type AuditBundle,
  canonicalizeBundle,
  verifyAuditBundle,
} from './index';

describe('canonicalJson (RFC 8785)', () => {
  it('sorts object keys by UTF-16 code units', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 1, A: 2 })).toBe('{"A":2,"a":1}');
  });

  it('sorts keys recursively at every level', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('escapes control characters and quotes/backslashes (soh = char code 1)', () => {
    expect(canonicalJson('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalJson('')).toBe('"\\u0001"');
    expect(canonicalJson('\n\t')).toBe('"\\n\\t"');
  });

  it('represents zero canonically', () => {
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-0)).toBe('0');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
  });

  it('skips undefined object members (RFC 8785 / IEEE 754 absence)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('emits null for undefined array elements', () => {
    expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('returns a Buffer of UTF-8 bytes', () => {
    const buf = canonicalJsonBytes({ a: 'ñ' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString('utf8')).toBe('{"a":"ñ"}');
  });
});

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function makeBundle(publicKey: string): AuditBundle {
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
        input: { path: 'a.ts', x: 1 },
        output: { y: 2, z: 3 },
        decision: 'auto',
        isError: false,
        durationMs: 42,
        createdAt: '2026-05-28T00:00:00.000Z',
        triggerSource: 'user',
        runnerId: null,
      },
    ],
  };
}

describe('canonicalizeBundle survives a no-op JSON reserialization', () => {
  it('still verifies after JSON.parse(JSON.stringify(bundle))', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const original = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(original), privateKey).toString('base64');

    const reserialized = JSON.parse(JSON.stringify(original)) as AuditBundle;
    const result = verifyAuditBundle({ bundle: reserialized, signature });
    expect(result.ok).toBe(true);
  });

  it('still verifies when entry-level keys are constructed in a different order', () => {
    const { privateKey, publicKeyPem } = makeKeyPair();
    const original = makeBundle(publicKeyPem);
    const signature = sign(null, canonicalizeBundle(original), privateKey).toString('base64');

    const entry = original.entries[0]!;
    const reorderedEntries = [
      {
        runnerId: entry.runnerId,
        triggerSource: entry.triggerSource,
        createdAt: entry.createdAt,
        durationMs: entry.durationMs,
        isError: entry.isError,
        decision: entry.decision,
        output: entry.output,
        input: entry.input,
        toolName: entry.toolName,
        messageId: entry.messageId,
        id: entry.id,
      },
    ];
    const reorderedBundle: AuditBundle = {
      entries: reorderedEntries,
      publicKey: original.publicKey,
      deviceId: original.deviceId,
      generatedAt: original.generatedAt,
      format: original.format,
    };

    const result = verifyAuditBundle({ bundle: reorderedBundle, signature });
    expect(result.ok).toBe(true);
  });
});
