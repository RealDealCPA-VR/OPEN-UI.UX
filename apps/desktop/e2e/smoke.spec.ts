// Opt-in local-only e2e smoke. Not run in CI yet — Electron on Linux CI needs xvfb.
import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.resolve(here, '..', 'out', 'main', 'index.js');

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
