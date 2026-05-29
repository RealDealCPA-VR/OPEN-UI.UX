import Database from 'better-sqlite3';
import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJsonBytes } from '@opencodex/audit-verify';

vi.mock('../storage/secrets', () => {
  let stored: string | null = null;
  return {
    setSecret: async (_acct: string, val: string) => {
      stored = val;
    },
    getSecret: async () => stored,
  };
});

vi.mock('../storage/settings', () => {
  const state: { auditPublicKeyPem: string; auditDeviceId: string } = {
    auditPublicKeyPem: '',
    auditDeviceId: '',
  };
  return {
    getSettings: () => state,
    updateSettings: (patch: Partial<typeof state>) => {
      Object.assign(state, patch);
      return state;
    },
  };
});

import { _resetSigningKeyCacheForTesting } from '../tool-audit/audit-signing';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { createConversation, appendMessage } from '../storage/conversations';
import { recordAppliedDiff } from '../storage/applied-diffs';
import { buildSignedProvenanceBundle } from './provenance-bundle';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
  _resetSigningKeyCacheForTesting();
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

describe('buildSignedProvenanceBundle', () => {
  it('returns null when the conversation does not exist', async () => {
    const result = await buildSignedProvenanceBundle('does-not-exist');
    expect(result).toBeNull();
  });

  it('captures the conversation, messages, and every applied diff with full provenance', async () => {
    const conv = createConversation({
      title: 'demo',
      providerId: 'openai',
      modelId: 'gpt-4o',
    });
    const userMsg = appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'edit foo.ts',
    });
    const asstMsg = appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'editing',
      providerId: 'openai',
      modelId: 'gpt-4o',
      inputTokens: 11,
      outputTokens: 7,
      costUsd: 0.0007,
    });
    recordAppliedDiff({
      conversationId: conv.id,
      messageId: asstMsg.id,
      filePath: 'foo.ts',
      diff: '--- a\n+++ b\n@@ @@\n-old\n+new\n',
      promptSnapshot: 'do it',
      ragCitations: [{ path: 'foo.ts', score: 0.5 }],
      routingDecision: { providerId: 'openai', modelId: 'gpt-4o' },
      providerId: 'openai',
      modelId: 'gpt-4o',
      tokensInput: 100,
      tokensOutput: 50,
      costUsd: 0.001,
      seed: 42,
    });

    const signed = await buildSignedProvenanceBundle(conv.id);
    expect(signed).not.toBeNull();
    if (!signed) return;

    expect(signed.bundle.format).toBe('opencodex-provenance-v1');
    expect(signed.bundle.bundleVersion).toBe(1);
    expect(signed.bundle.conversation.id).toBe(conv.id);
    expect(signed.bundle.messages).toHaveLength(2);
    expect(signed.bundle.messages.map((m) => m.id)).toEqual([userMsg.id, asstMsg.id]);
    expect(signed.bundle.appliedDiffs).toHaveLength(1);
    const diff = signed.bundle.appliedDiffs[0];
    expect(diff?.filePath).toBe('foo.ts');
    expect(diff?.promptSnapshot).toBe('do it');
    expect(diff?.providerId).toBe('openai');
    expect(diff?.modelId).toBe('gpt-4o');
    expect(diff?.tokensInput).toBe(100);
    expect(diff?.costUsd).toBeCloseTo(0.001, 5);
    expect(diff?.seed).toBe(42);
    expect(diff?.ragCitationsJson).toBeTruthy();
    expect(diff?.routingDecisionJson).toBeTruthy();

    expect(signed.bundle.publicKey).toMatch(/PUBLIC KEY/);
    expect(signed.bundle.deviceId.length).toBeGreaterThan(0);
    expect(signed.signature.length).toBeGreaterThan(0);
  });

  it('signature verifies against the embedded public key and breaks on tampering', async () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: 'hi' });
    recordAppliedDiff({
      conversationId: conv.id,
      messageId: msg.id,
      filePath: 'a.ts',
      diff: 'd',
    });

    const signed = await buildSignedProvenanceBundle(conv.id);
    expect(signed).not.toBeNull();
    if (!signed) return;

    const payload = canonicalJsonBytes(signed.bundle);
    const sigBuf = Buffer.from(signed.signature, 'base64');
    const verified = verify(null, payload, signed.bundle.publicKey, sigBuf);
    expect(verified).toBe(true);

    const tampered = {
      ...signed.bundle,
      messages: signed.bundle.messages.map((m) => ({ ...m, content: 'evil' })),
    };
    const tamperedPayload = canonicalJsonBytes(tampered);
    expect(verify(null, tamperedPayload, signed.bundle.publicKey, sigBuf)).toBe(false);
  });

  it('honours injected deps (deviceId, nowIso, custom key)', async () => {
    const conv = createConversation({});
    appendMessage({ conversationId: conv.id, role: 'user', content: 'q' });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const signed = await buildSignedProvenanceBundle(conv.id, {
      loadKey: async () => ({ privateKey, publicKeyPem }),
      deviceIdFactory: () => 'fixed-device',
      nowIso: () => '2026-01-02T03:04:05.000Z',
    });
    expect(signed).not.toBeNull();
    if (!signed) return;
    expect(signed.bundle.deviceId).toBe('fixed-device');
    expect(signed.bundle.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(signed.bundle.publicKey).toBe(publicKeyPem);

    const ok = verify(
      null,
      canonicalJsonBytes(signed.bundle),
      publicKey,
      Buffer.from(signed.signature, 'base64'),
    );
    expect(ok).toBe(true);
  });
});
