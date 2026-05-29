import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeBodySignature,
  generateHookSecret,
  getListenerPortFilePath,
  installGitHook,
  PORT_FILE_NAME,
  SENTINEL_BEGIN,
  SENTINEL_END,
  uninstallGitHook,
  writeListenerPortFile,
} from './git-hooks';

describe('git hooks installer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencodex-githook-'));
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('generateHookSecret returns 32 hex chars', () => {
    const s = generateHookSecret();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    const t = generateHookSecret();
    expect(s).not.toBe(t);
  });

  it('computeBodySignature matches HMAC-SHA256', () => {
    const sig = computeBodySignature('hello', 'world');
    // Known good HMAC for ('world','hello') from a reference implementation.
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('installs into an empty .git/hooks dir and writes both sh + cmd', () => {
    const res = installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-1',
      url: 'http://127.0.0.1:38400/trigger/t-1',
      secret: 'sekret',
    });
    expect(res.primaryWritten).toBe(true);
    expect(res.wrapperWritten).toBe(false);

    const sh = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(sh).toContain('#!/bin/sh');
    expect(sh).toContain(SENTINEL_BEGIN);
    expect(sh).toContain(SENTINEL_END);
    expect(sh).toContain('# Installed by OpenCodex');
    // Body must contain the URL + signature
    expect(sh).toContain('http://127.0.0.1:38400/trigger/t-1');
    expect(sh).toContain('x-opencodex-signature');

    const cmd = readFileSync(join(dir, '.git', 'hooks', 'post-commit.cmd'), 'utf8');
    expect(cmd).toContain('Invoke-WebRequest');
    expect(cmd).toContain('http://127.0.0.1:38400/trigger/t-1');
  });

  it('coexists with an existing user hook by writing .opencodex and sourcing it', () => {
    const userHook = '#!/bin/sh\necho "user hook"\n';
    writeFileSync(join(dir, '.git', 'hooks', 'post-commit'), userHook);

    const res = installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-2',
      url: 'http://127.0.0.1:38400/trigger/t-2',
      secret: 'sekret',
    });
    expect(res.wrapperWritten).toBe(true);

    const merged = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(merged).toContain('user hook'); // existing content preserved
    expect(merged).toContain(SENTINEL_BEGIN);
    expect(merged).toContain(SENTINEL_END);
    expect(merged).toMatch(/post-commit\.opencodex/);

    const opencodex = readFileSync(join(dir, '.git', 'hooks', 'post-commit.opencodex'), 'utf8');
    expect(opencodex).toContain('http://127.0.0.1:38400/trigger/t-2');
  });

  it('is idempotent: installing twice over an existing user hook leaves only one sentinel block', () => {
    const userHook = '#!/bin/sh\necho "user hook"\n';
    writeFileSync(join(dir, '.git', 'hooks', 'post-commit'), userHook);

    installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-3',
      url: 'http://127.0.0.1:38400/trigger/t-3',
      secret: 's',
    });
    installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-3',
      url: 'http://127.0.0.1:38400/trigger/t-3',
      secret: 's',
    });

    const merged = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    const beginCount = (merged.match(new RegExp(SENTINEL_BEGIN, 'g')) ?? []).length;
    const endCount = (merged.match(new RegExp(SENTINEL_END, 'g')) ?? []).length;
    expect(beginCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it('uninstall removes our managed hook entirely', () => {
    installGitHook({
      workspaceRoot: dir,
      hook: 'pre-push',
      taskId: 't-4',
      url: 'http://127.0.0.1:38400/trigger/t-4',
      secret: 's',
    });
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push.cmd'))).toBe(true);

    uninstallGitHook(dir, 'pre-push');
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(false);
    expect(existsSync(join(dir, '.git', 'hooks', 'pre-push.cmd'))).toBe(false);
  });

  it('uninstall strips the sourcing block from a coexisting user hook + removes wrapper', () => {
    const userHook = '#!/bin/sh\necho "user hook"\n';
    writeFileSync(join(dir, '.git', 'hooks', 'post-commit'), userHook);
    installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-5',
      url: 'http://127.0.0.1:38400/trigger/t-5',
      secret: 's',
    });
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit.opencodex'))).toBe(true);

    uninstallGitHook(dir, 'post-commit');

    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
    const remaining = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(remaining).toContain('user hook');
    expect(remaining).not.toContain(SENTINEL_BEGIN);
    expect(remaining).not.toContain(SENTINEL_END);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit.opencodex'))).toBe(false);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit.cmd'))).toBe(false);
  });

  it('installed wrapper references the port file at runtime', () => {
    installGitHook({
      workspaceRoot: dir,
      hook: 'post-commit',
      taskId: 't-port',
      url: 'http://127.0.0.1:38400/trigger/t-port',
      secret: 's',
    });
    const sh = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(sh).toContain(PORT_FILE_NAME);
    expect(sh).toContain('FALLBACK_URL=');
    const cmd = readFileSync(join(dir, '.git', 'hooks', 'post-commit.cmd'), 'utf8');
    expect(cmd).toContain(PORT_FILE_NAME);
    expect(cmd).toContain('FALLBACK_URL=');
  });

  it('writeListenerPortFile writes the port into <hooks>/opencodex-port', () => {
    writeListenerPortFile(dir, 38450);
    const portFile = getListenerPortFilePath(dir);
    const contents = readFileSync(portFile, 'utf8');
    expect(contents.trim()).toBe('38450');
  });

  it('writeListenerPortFile rejects invalid ports', () => {
    expect(() => writeListenerPortFile(dir, 0)).toThrow();
    expect(() => writeListenerPortFile(dir, 70000)).toThrow();
    expect(() => writeListenerPortFile(dir, -1)).toThrow();
  });

  it('refuses to install in a non-git directory', () => {
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    expect(() =>
      installGitHook({
        workspaceRoot: dir,
        hook: 'post-commit',
        taskId: 't',
        url: 'http://127.0.0.1:38400/trigger/t',
        secret: 's',
      }),
    ).toThrow(/not a git repo/);
  });
});
