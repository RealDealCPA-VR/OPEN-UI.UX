// CI runs this on ubuntu-latest under xvfb-run (see .github/workflows/ci.yml).
// Windows / macOS rely on local `pnpm --filter @opencodex/desktop run e2e` because
// Electron+Playwright session teardown is flaky on hosted Windows runners.
import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.resolve(here, '..', 'out', 'main', 'index.cjs');

test('app launches and first window reaches readyState complete', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  try {
    const window = await app.firstWindow();
    const state = await window.evaluate(() => document.readyState);
    expect(state).toBe('complete');
  } finally {
    await app.close();
  }
});
