import { describe, expect, it, vi } from 'vitest';

// approval-handlers imports electron + storage/settings at module load; stub
// them so we can import the exported zod schema (the FIRST IPC boundary) without
// pulling in Electron or the keytar-backed settings store.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../ipc/registry', () => ({ registerInvoke: vi.fn() }));
vi.mock('../storage/settings', () => ({
  getApprovalPolicies: vi.fn(),
  getReadOnlyChatMode: vi.fn(),
  getSettings: vi.fn(),
  setApprovalPolicies: vi.fn(),
}));
vi.mock('./approvals', () => ({
  getApprovalManager: vi.fn(),
  initApprovalManager: vi.fn(),
}));
vi.mock('./file-preview', () => ({ readFilePreview: vi.fn() }));

import { approvalRespondSchema } from './approval-handlers';

describe('approvalRespondSchema (approvals:respond IPC boundary)', () => {
  it('accepts a plain allow with no override', () => {
    const parsed = approvalRespondSchema.safeParse({
      requestId: 'r1',
      decision: 'allow',
      scope: 'once',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a valid write_file override', () => {
    const parsed = approvalRespondSchema.safeParse({
      requestId: 'r1',
      decision: 'allow',
      scope: 'once',
      override: { toolName: 'write_file', arguments: { path: 'src/a.ts', content: 'x' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an override whose toolName is not write_file', () => {
    const parsed = approvalRespondSchema.safeParse({
      requestId: 'r1',
      decision: 'allow',
      scope: 'once',
      override: { toolName: 'edit_file', arguments: { path: 'src/a.ts', content: 'x' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an override with a missing path', () => {
    const parsed = approvalRespondSchema.safeParse({
      requestId: 'r1',
      decision: 'allow',
      scope: 'once',
      override: { toolName: 'write_file', arguments: { content: 'x' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an override with an empty path', () => {
    const parsed = approvalRespondSchema.safeParse({
      requestId: 'r1',
      decision: 'allow',
      scope: 'once',
      override: { toolName: 'write_file', arguments: { path: '', content: 'x' } },
    });
    expect(parsed.success).toBe(false);
  });
});
