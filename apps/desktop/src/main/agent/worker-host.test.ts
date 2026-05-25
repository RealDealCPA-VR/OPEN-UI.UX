import { describe, expect, it } from 'vitest';
import { isUtilityProcessAvailable, runSubagentInWorker } from './worker-host';

describe('worker-host (no electron available)', () => {
  it('isUtilityProcessAvailable returns false outside Electron', async () => {
    expect(await isUtilityProcessAvailable()).toBe(false);
  });

  it('runSubagentInWorker rejects with a clear error outside Electron', async () => {
    await expect(
      runSubagentInWorker({
        task: 'x',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        workspaceRoot: '/tmp/ws',
      }),
    ).rejects.toThrow(/electron utilityProcess is not available/);
  });
});
