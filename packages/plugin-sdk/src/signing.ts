import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { PluginManifest } from './manifest';

export interface TrustedKey {
  id: string;
  publicKey: string;
}

export interface VerifyResult {
  ok: boolean;
  signer?: string;
  reason?: string;
}

export function canonicalizeManifest(manifest: PluginManifest): string {
  return canonicalJson(manifest);
}

export function signManifest(manifest: PluginManifest, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf8');
  const signature = sign(null, payload, key);
  return signature.toString('base64');
}

export function verifyManifest(
  manifest: PluginManifest,
  signature: string,
  trustedKeys: ReadonlyArray<TrustedKey>,
): VerifyResult {
  if (!signature || typeof signature !== 'string') {
    return { ok: false, reason: 'missing signature' };
  }
  if (trustedKeys.length === 0) {
    return { ok: false, reason: 'no trusted keys configured' };
  }
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'base64');
  } catch {
    return { ok: false, reason: 'signature is not valid base64' };
  }
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf8');
  for (const key of trustedKeys) {
    try {
      const pub = createPublicKey(key.publicKey);
      if (verify(null, payload, pub, sigBuf)) {
        return { ok: true, signer: key.id };
      }
    } catch {
      // try the next key
    }
  }
  return { ok: false, reason: 'no trusted key matched signature' };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + canonicalJson(v));
  }
  return '{' + parts.join(',') + '}';
}
