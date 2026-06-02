import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const state: { exitCode: number } = { exitCode: 0 };
  const spawnMock = (): EventEmitter => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', state.exitCode));
    return child;
  };
  return { spawnMock, state };
});

vi.mock('node:child_process', () => ({
  spawn: harness.spawnMock,
}));

import { getAvailableOllamaInstallers } from './ollama-installer';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('getAvailableOllamaInstallers — script SHA gating', () => {
  beforeEach(() => {
    harness.state.exitCode = 0; // probeBinary sees every binary as present
    setPlatform('linux');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('omits the script installer when no install.sh hash is pinned (default empty)', async () => {
    // Default INSTALL_SCRIPT_SHA256 is '' so the script installer fails closed.
    const installers = await getAvailableOllamaInstallers();
    expect(installers).not.toContain('script');
    expect(installers).toContain('homebrew');
  });

  it('omits the script installer when an explicit empty hash is provided', async () => {
    const installers = await getAvailableOllamaInstallers({ expectedScriptSha256: '' });
    expect(installers).not.toContain('script');
  });

  it('offers the script installer once a non-empty hash is pinned', async () => {
    const installers = await getAvailableOllamaInstallers({
      expectedScriptSha256: 'deadbeef',
    });
    expect(installers).toContain('script');
  });

  it('never offers the script installer on win32 regardless of hash', async () => {
    setPlatform('win32');
    const installers = await getAvailableOllamaInstallers({
      expectedScriptSha256: 'deadbeef',
    });
    expect(installers).not.toContain('script');
  });
});
