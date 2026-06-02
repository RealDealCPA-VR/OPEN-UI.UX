import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: Object.assign(
    function Notification() {
      return { on: () => undefined, show: () => undefined };
    },
    { isSupported: () => false },
  ),
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { __createRequestSchemaForTests, __updateRequestSchemaForTests } from './handlers';

describe('scheduler IPC request schemas — runnerId boundary', () => {
  it('create-task schema preserves runnerId (does not strip it)', () => {
    const parsed = __createRequestSchemaForTests.parse({
      name: 'n',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
      runnerId: 'claude-code',
    });
    expect(parsed.runnerId).toBe('claude-code');
  });

  it('create-task schema accepts null runnerId', () => {
    const parsed = __createRequestSchemaForTests.parse({
      name: 'n',
      trigger: { type: 'manual' },
      prompt: 'p',
      providerId: 'openai',
      model: 'm',
      workspacePath: '/tmp/ws',
      runnerId: null,
    });
    expect(parsed.runnerId).toBeNull();
  });

  it('update-task schema preserves runnerId (does not strip it)', () => {
    const parsed = __updateRequestSchemaForTests.parse({
      id: 'task-1',
      runnerId: 'claude-code',
    });
    expect(parsed.runnerId).toBe('claude-code');
  });
});
