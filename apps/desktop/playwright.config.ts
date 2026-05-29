import { defineConfig } from '@playwright/test';

// Per-OS project names so CI can pin a project with `--project=electron-linux`
// for clear reporting. We only register the project matching the host OS so
// `pnpm e2e` without args doesn't fan out three runs against one binary.
const projectName =
  process.platform === 'win32'
    ? 'electron-windows'
    : process.platform === 'darwin'
      ? 'electron-macos'
      : 'electron-linux';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  retries: 2,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  projects: [{ name: projectName, use: {}, metadata: { os: process.platform } }],
});
