import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJsonBytes } from './canonical.js';

export { canonicalJson, canonicalJsonBytes } from './canonical.js';

export const AUDIT_BUNDLE_FORMAT = 'opencodex-audit-v1' as const;

export const auditBundleEntrySchema = z.object({
  id: z.string(),
  messageId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  decision: z.string(),
  isError: z.boolean(),
  durationMs: z.number().nullable(),
  createdAt: z.string(),
  triggerSource: z.string(),
  runnerId: z.string().nullable(),
  conversationId: z.string().optional(),
  conversationTitle: z.string().optional(),
  filePath: z.string().nullable().optional(),
});

export type AuditBundleEntry = z.infer<typeof auditBundleEntrySchema>;

export const auditBundleSchema = z.object({
  format: z.literal(AUDIT_BUNDLE_FORMAT),
  generatedAt: z.string(),
  deviceId: z.string(),
  publicKey: z.string(),
  entries: z.array(auditBundleEntrySchema),
});

export type AuditBundle = z.infer<typeof auditBundleSchema>;

export const auditBundleEnvelopeSchema = z.object({
  bundle: auditBundleSchema,
  signature: z.string(),
});

export type AuditBundleEnvelope = z.infer<typeof auditBundleEnvelopeSchema>;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  deviceId?: string;
  entryCount?: number;
  generatedAt?: string;
}

export function canonicalizeBundle(bundle: AuditBundle): Buffer {
  return canonicalJsonBytes(bundle);
}

export interface VerifyOptions {
  /** Override the public key embedded in the bundle. SPKI PEM or raw base64. */
  publicKeyOverride?: string;
}

export function verifyAuditBundle(
  envelope: AuditBundleEnvelope,
  options: VerifyOptions = {},
): VerifyResult {
  const { bundle, signature } = envelope;
  const pubKeySource = options.publicKeyOverride ?? bundle.publicKey;
  let keyObject;
  try {
    keyObject = parsePublicKey(pubKeySource);
  } catch (err) {
    return { ok: false, reason: `bad public key: ${(err as Error).message}` };
  }
  const sigBuf = Buffer.from(signature, 'base64');
  const payload = canonicalizeBundle(bundle);
  const ok = verify(null, payload, keyObject, sigBuf);
  if (!ok) {
    return { ok: false, reason: 'signature does not match' };
  }
  return {
    ok: true,
    deviceId: bundle.deviceId,
    entryCount: bundle.entries.length,
    generatedAt: bundle.generatedAt,
  };
}

function parsePublicKey(source: string) {
  const trimmed = source.trim();
  if (trimmed.startsWith('-----BEGIN ')) {
    return createPublicKey({ key: trimmed, format: 'pem' });
  }
  // Raw base64 SPKI (32-byte payload before base64 = 44 chars). Decode then wrap.
  const der = Buffer.from(trimmed, 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function parseEnvelope(rawJson: string): AuditBundleEnvelope {
  const data: unknown = JSON.parse(rawJson);
  return auditBundleEnvelopeSchema.parse(data);
}
