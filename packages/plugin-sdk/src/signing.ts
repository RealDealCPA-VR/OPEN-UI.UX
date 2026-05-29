import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
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

export const SIGNATURE_ENVELOPE_VERSION = 1 as const;

export const signatureEnvelopeSchema = z
  .object({
    v: z.literal(1),
    payload: z.string().min(1),
    sig: z.string().min(1),
  })
  .strict();

export type SignatureEnvelope = z.infer<typeof signatureEnvelopeSchema>;

export function canonicalizeManifest(manifest: PluginManifest): string {
  return canonicalJson(manifest);
}

export function signManifest(manifest: PluginManifest, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf8');
  const signature = sign(null, payload, key);
  return signature.toString('base64');
}

export function signManifestEnvelope(
  manifest: PluginManifest,
  privateKeyPem: string,
): SignatureEnvelope {
  const sig = signManifest(manifest, privateKeyPem);
  return { v: SIGNATURE_ENVELOPE_VERSION, payload: canonicalizeManifest(manifest), sig };
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
  const rawSig = extractRawSignature(signature);
  if (rawSig.kind === 'invalid') {
    return { ok: false, reason: rawSig.reason };
  }
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(rawSig.sig, 'base64');
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
      continue;
    }
  }
  return { ok: false, reason: 'no trusted key matched signature' };
}

type RawSig = { kind: 'raw'; sig: string } | { kind: 'invalid'; reason: string };

function extractRawSignature(input: string): RawSig {
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { kind: 'invalid', reason: 'signature envelope is not valid JSON' };
    }
    const env = signatureEnvelopeSchema.safeParse(parsed);
    if (!env.success) {
      return { kind: 'invalid', reason: `unsupported signature envelope: ${env.error.message}` };
    }
    return { kind: 'raw', sig: env.data.sig };
  }
  return { kind: 'raw', sig: trimmed };
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
