import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeBundle, verifyAuditBundle } from '@opencodex/audit-verify';

// We mock the keychain + settings modules so the test doesn't need keytar.
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

import { _resetSigningKeyCacheForTesting } from './audit-signing';
import { exportAuditBundle } from './audit-export';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { createConversation, appendMessage } from '../storage/conversations';
import { recordToolCall } from '../storage/tool-audit';

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

describe('exportAuditBundle', () => {
  it('produces a signed bundle that verifies', async () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'write_file',
      input: { path: 'src/a.ts', content: 'export const x = 1;' },
      output: { ok: true },
      decision: 'auto',
      isError: false,
      durationMs: 7,
    });
    recordToolCall({
      messageId: msg.id,
      toolName: 'read_file',
      input: { path: 'src/b.ts' },
      output: '...',
      decision: 'auto',
      isError: false,
      durationMs: 3,
    });

    const envelope = await exportAuditBundle({}, db);
    expect(envelope.bundle.entries).toHaveLength(2);
    expect(envelope.bundle.format).toBe('opencodex-audit-v1');
    expect(envelope.signature.length).toBeGreaterThan(0);

    const result = verifyAuditBundle(envelope);
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBe(2);
  });

  it('filters by file path via input_json LIKE', async () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'write_file',
      input: { path: 'src/a.ts' },
      output: null,
      decision: 'auto',
      isError: false,
      durationMs: 7,
    });
    recordToolCall({
      messageId: msg.id,
      toolName: 'write_file',
      input: { path: 'other/b.ts' },
      output: null,
      decision: 'auto',
      isError: false,
      durationMs: 7,
    });

    const envelope = await exportAuditBundle({ filePath: 'src/' }, db);
    expect(envelope.bundle.entries).toHaveLength(1);
    expect((envelope.bundle.entries[0] as { filePath: string }).filePath).toBe('src/a.ts');
  });

  it('tampering breaks verification', async () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    recordToolCall({
      messageId: msg.id,
      toolName: 'write_file',
      input: { path: 'src/a.ts' },
      output: null,
      decision: 'auto',
      isError: false,
      durationMs: 7,
    });

    const envelope = await exportAuditBundle({}, db);
    const tampered = {
      bundle: {
        ...envelope.bundle,
        entries: envelope.bundle.entries.map((e) => ({
          ...(e as Record<string, unknown>),
          output: { malicious: true },
        })),
      },
      signature: envelope.signature,
    };
    // Re-canonicalize to confirm bytes differ.
    expect(
      canonicalizeBundle(tampered.bundle as unknown as Parameters<typeof canonicalizeBundle>[0]),
    ).not.toEqual(canonicalizeBundle(envelope.bundle));
    const result = verifyAuditBundle(
      tampered as unknown as Parameters<typeof verifyAuditBundle>[0],
    );
    expect(result.ok).toBe(false);
  });
});
