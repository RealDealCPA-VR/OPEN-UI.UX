import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ManifestSchema, type PluginManifest } from './manifest';

export interface TrustedKey {
  id: string;
  publicKey: string;
}

export interface VerifyResult {
  ok: boolean;
  signer?: string;
  reason?: string;
}

// v1 envelopes signed only the canonical manifest. v2 signs an integrity
// payload that also covers SHA-256 hashes of every entry file the manifest
// references, so swapping plugin code after signing is detectable.
export const LEGACY_SIGNATURE_ENVELOPE_VERSION = 1 as const;
export const SIGNATURE_ENVELOPE_VERSION = 2 as const;

const envelopeV1Schema = z
  .object({
    v: z.literal(LEGACY_SIGNATURE_ENVELOPE_VERSION),
    payload: z.string().min(1),
    sig: z.string().min(1),
  })
  .strict();

const envelopeV2Schema = z
  .object({
    v: z.literal(SIGNATURE_ENVELOPE_VERSION),
    payload: z.string().min(1),
    sig: z.string().min(1),
  })
  .strict();

export const signatureEnvelopeSchema = z.discriminatedUnion('v', [
  envelopeV1Schema,
  envelopeV2Schema,
]);

export type SignatureEnvelope = z.infer<typeof signatureEnvelopeSchema>;

export const integrityFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type IntegrityFile = z.infer<typeof integrityFileSchema>;

export const integrityPayloadSchema = z
  .object({
    files: z.array(integrityFileSchema),
    manifest: ManifestSchema,
  })
  .strict();

export type IntegrityPayload = z.infer<typeof integrityPayloadSchema>;

export function canonicalizeManifest(manifest: PluginManifest): string {
  return canonicalJson(manifest);
}

// Manifest entry paths may be authored with either separator; hashes must key
// on one canonical form or Windows-signed plugins fail verification on POSIX.
export function normalizeIntegrityPath(path: string): string {
  return path.split('\\').join('/');
}

export function collectIntegrityFilePaths(manifest: PluginManifest): string[] {
  const paths = new Set<string>();
  paths.add(normalizeIntegrityPath(manifest.entry));
  for (const panel of manifest.contributions.panels ?? []) {
    paths.add(normalizeIntegrityPath(panel.entry));
  }
  for (const command of manifest.contributions.slashCommands ?? []) {
    paths.add(normalizeIntegrityPath(command.entry));
  }
  return [...paths].sort();
}

export interface HashPluginFilesOptions {
  // Skip files that cannot be read instead of throwing. Verification uses
  // this so a deleted entry file surfaces as a coverage gap (tampered) rather
  // than an exception.
  ignoreMissing?: boolean;
}

export async function hashPluginFiles(
  pluginPath: string,
  manifest: PluginManifest,
  options: HashPluginFilesOptions = {},
): Promise<IntegrityFile[]> {
  const out: IntegrityFile[] = [];
  for (const rel of collectIntegrityFilePaths(manifest)) {
    let data: Buffer;
    try {
      data = await readFile(resolve(pluginPath, rel));
    } catch (err) {
      if (options.ignoreMissing) continue;
      throw new Error(
        `cannot hash plugin file "${rel}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    out.push({ path: rel, sha256: createHash('sha256').update(data).digest('hex') });
  }
  return out;
}

export function buildIntegrityPayload(
  manifest: PluginManifest,
  files: ReadonlyArray<IntegrityFile>,
): string {
  const sorted = [...files]
    .map((f) => ({ path: normalizeIntegrityPath(f.path), sha256: f.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return canonicalJson({ files: sorted, manifest });
}

export function signManifest(manifest: PluginManifest, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf8');
  const signature = sign(null, payload, key);
  return signature.toString('base64');
}

/** @deprecated v1 envelopes carry no file hashes and fail closed when verified against trusted keys. Use signPluginEnvelope / signPluginDirectory. */
export function signManifestEnvelope(
  manifest: PluginManifest,
  privateKeyPem: string,
): SignatureEnvelope {
  const sig = signManifest(manifest, privateKeyPem);
  return { v: LEGACY_SIGNATURE_ENVELOPE_VERSION, payload: canonicalizeManifest(manifest), sig };
}

export function signPluginEnvelope(
  manifest: PluginManifest,
  files: ReadonlyArray<IntegrityFile>,
  privateKeyPem: string,
): SignatureEnvelope {
  const payload = buildIntegrityPayload(manifest, files);
  const key = createPrivateKey(privateKeyPem);
  const sig = sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
  return { v: SIGNATURE_ENVELOPE_VERSION, payload, sig };
}

export async function signPluginDirectory(
  pluginPath: string,
  manifest: PluginManifest,
  privateKeyPem: string,
): Promise<SignatureEnvelope> {
  const files = await hashPluginFiles(pluginPath, manifest);
  return signPluginEnvelope(manifest, files, privateKeyPem);
}

export type PluginVerification =
  | { status: 'unsigned'; reason: string }
  | { status: 'untrusted'; reason: string }
  | { status: 'signed'; signer: string }
  | { status: 'tampered'; signer: string; reason: string };

// Full integrity verification: signature over the envelope payload AND the
// payload's file hashes against what is actually on disk (actualFiles, as
// computed by hashPluginFiles with ignoreMissing). Only trusted-signed
// plugins can come back 'tampered' — anything that fails to verify against a
// trusted key stays on the unsigned/untrusted path so sideload flows keep
// working.
export function verifyPluginIntegrity(
  manifest: PluginManifest,
  signature: string,
  trustedKeys: ReadonlyArray<TrustedKey>,
  actualFiles: ReadonlyArray<IntegrityFile>,
): PluginVerification {
  if (!signature || signature.trim().length === 0) {
    return { status: 'unsigned', reason: 'missing signature' };
  }
  if (trustedKeys.length === 0) {
    return { status: 'untrusted', reason: 'no trusted keys configured' };
  }
  const parsed = parseSignature(signature);
  if (parsed.kind === 'invalid') {
    return { status: 'untrusted', reason: parsed.reason };
  }
  if (parsed.kind === 'legacy') {
    const legacy = verifyManifest(manifest, parsed.sig, trustedKeys);
    if (!legacy.ok || !legacy.signer) {
      return { status: 'untrusted', reason: legacy.reason ?? 'no trusted key matched signature' };
    }
    // Fail closed: a trusted signature with zero hash coverage would let an
    // attacker swap entry code while keeping the old manifest signature.
    return {
      status: 'tampered',
      signer: legacy.signer,
      reason:
        'legacy manifest-only signature carries no file hash coverage; re-sign with signPluginDirectory',
    };
  }
  const sigBuf = decodeBase64(parsed.sig);
  if (!sigBuf) {
    return { status: 'untrusted', reason: 'signature is not valid base64' };
  }
  const signer = findSigner(Buffer.from(parsed.payload, 'utf8'), sigBuf, trustedKeys);
  if (!signer) {
    return { status: 'untrusted', reason: 'no trusted key matched signature' };
  }
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(parsed.payload);
  } catch {
    return { status: 'tampered', signer, reason: 'signed payload is not valid JSON' };
  }
  const payload = integrityPayloadSchema.safeParse(payloadJson);
  if (!payload.success) {
    return { status: 'tampered', signer, reason: 'signed payload is malformed' };
  }
  if (canonicalizeManifest(payload.data.manifest) !== canonicalizeManifest(manifest)) {
    return { status: 'tampered', signer, reason: 'manifest does not match signed payload' };
  }
  const signedHashes = new Map(
    payload.data.files.map((f) => [normalizeIntegrityPath(f.path), f.sha256]),
  );
  const actualHashes = new Map(actualFiles.map((f) => [normalizeIntegrityPath(f.path), f.sha256]));
  for (const path of collectIntegrityFilePaths(manifest)) {
    const expected = signedHashes.get(path);
    if (!expected) {
      return {
        status: 'tampered',
        signer,
        reason: `file referenced by manifest has no signed hash: ${path}`,
      };
    }
    const actual = actualHashes.get(path);
    if (!actual) {
      return {
        status: 'tampered',
        signer,
        reason: `file referenced by manifest is missing on disk: ${path}`,
      };
    }
    if (actual !== expected) {
      return { status: 'tampered', signer, reason: `file hash mismatch: ${path}` };
    }
  }
  return { status: 'signed', signer };
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
  const parsed = parseSignature(signature);
  if (parsed.kind === 'invalid') {
    return { ok: false, reason: parsed.reason };
  }
  if (parsed.kind === 'v2') {
    return { ok: false, reason: 'envelope v2 must be verified with verifyPluginIntegrity' };
  }
  const sigBuf = decodeBase64(parsed.sig);
  if (!sigBuf) {
    return { ok: false, reason: 'signature is not valid base64' };
  }
  const payload = Buffer.from(canonicalizeManifest(manifest), 'utf8');
  const signer = findSigner(payload, sigBuf, trustedKeys);
  if (signer) return { ok: true, signer };
  return { ok: false, reason: 'no trusted key matched signature' };
}

type ParsedSignature =
  | { kind: 'legacy'; sig: string }
  | { kind: 'v2'; payload: string; sig: string }
  | { kind: 'invalid'; reason: string };

function parseSignature(input: string): ParsedSignature {
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
    if (env.data.v === SIGNATURE_ENVELOPE_VERSION) {
      return { kind: 'v2', payload: env.data.payload, sig: env.data.sig };
    }
    return { kind: 'legacy', sig: env.data.sig };
  }
  return { kind: 'legacy', sig: trimmed };
}

function decodeBase64(input: string): Buffer | null {
  try {
    return Buffer.from(input, 'base64');
  } catch {
    return null;
  }
}

function findSigner(
  payload: Buffer,
  sig: Buffer,
  trustedKeys: ReadonlyArray<TrustedKey>,
): string | null {
  for (const key of trustedKeys) {
    try {
      const pub = createPublicKey(key.publicKey);
      if (verify(null, payload, pub, sig)) {
        return key.id;
      }
    } catch {
      continue;
    }
  }
  return null;
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
