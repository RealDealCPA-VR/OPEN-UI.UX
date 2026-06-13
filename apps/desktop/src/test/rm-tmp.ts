import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

// Windows briefly holds handles on freshly-touched files (antivirus, search
// indexer, just-exited git/child processes), so a bare recursive rm in test
// teardown intermittently fails with EBUSY/EPERM. Retrying absorbs that.
const RM_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
} as const;

export async function rmTmp(dir: string): Promise<void> {
  await rm(dir, RM_RETRY_OPTIONS);
}

export function rmTmpSync(dir: string): void {
  rmSync(dir, RM_RETRY_OPTIONS);
}
