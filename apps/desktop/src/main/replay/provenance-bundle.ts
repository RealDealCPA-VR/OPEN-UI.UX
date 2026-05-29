import { randomUUID, type KeyObject } from 'node:crypto';
import { canonicalJsonBytes } from '@opencodex/audit-verify';
import {
  PROVENANCE_BUNDLE_FORMAT,
  type ProvenanceBundle,
  type ProvenanceBundleMessage,
  type SignedProvenanceBundle,
} from '../../shared/replay';
import { listAppliedDiffsForConversation } from '../storage/applied-diffs';
import { getConversation, listMessages } from '../storage/conversations';
import { getSettings, updateSettings } from '../storage/settings';
import { getOrCreateAuditSigningKey, signAuditPayload } from '../tool-audit/audit-signing';

export interface SigningKeyMaterial {
  privateKey: KeyObject;
  publicKeyPem: string;
}

export interface BuildProvenanceBundleDeps {
  loadKey?: () => Promise<SigningKeyMaterial>;
  deviceIdFactory?: () => string;
  nowIso?: () => string;
}

function defaultDeviceId(): string {
  const settings = getSettings();
  if (settings.auditDeviceId && settings.auditDeviceId.length > 0) {
    return settings.auditDeviceId;
  }
  const id = randomUUID();
  updateSettings({ auditDeviceId: id });
  return id;
}

export async function buildSignedProvenanceBundle(
  conversationId: string,
  deps: BuildProvenanceBundleDeps = {},
): Promise<SignedProvenanceBundle | null> {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  const loadKey = deps.loadKey ?? getOrCreateAuditSigningKey;
  const deviceIdFactory = deps.deviceIdFactory ?? defaultDeviceId;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const { privateKey, publicKeyPem } = await loadKey();
  const stored = listMessages(conversationId);
  const messages: ProvenanceBundleMessage[] = stored.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    providerId: m.providerId,
    modelId: m.modelId,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    costUsd: m.costUsd,
    createdAt: m.createdAt,
  }));
  const appliedDiffs = listAppliedDiffsForConversation(conversationId);
  const bundle: ProvenanceBundle = {
    format: PROVENANCE_BUNDLE_FORMAT,
    bundleVersion: 1,
    exportedAt: nowIso(),
    deviceId: deviceIdFactory(),
    publicKey: publicKeyPem,
    conversation,
    messages,
    appliedDiffs,
  };
  const signature = signAuditPayload(canonicalJsonBytes(bundle), privateKey);
  return { bundle, signature };
}
