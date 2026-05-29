import { chmodSync, existsSync, openSync, writeSync, type PathLike } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallAuditRow } from '../../shared/tool-audit';
import { logger } from '../logger';

const WORM_FILENAME = 'audit-worm.ndjson';

interface WormState {
  fd: number;
  path: string;
}

let state: WormState | null = null;
let enabled = false;
let resolveUserData: (() => string) | null = null;

export interface WormMirrorOptions {
  /** Indirection so the module is usable in tests without Electron. */
  userDataPathResolver?: () => string;
  /** Override fs.openSync — for test isolation. Defaults to node:fs openSync. */
  open?: (path: PathLike, flags: string | number) => number;
  /** Override fs.writeSync — for test isolation. */
  write?: (fd: number, buffer: Buffer) => number;
}

let testOverrides: WormMirrorOptions = {};

export function configureWormMirror(opts: WormMirrorOptions): void {
  testOverrides = opts;
  if (opts.userDataPathResolver) resolveUserData = opts.userDataPathResolver;
}

export function initWormMirror(initiallyEnabled: boolean, userDataPath: string): void {
  resolveUserData = () => userDataPath;
  setWormEnabled(initiallyEnabled);
}

export function setWormEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  if (next) {
    openHandleIfNeeded();
  }
  // We deliberately do NOT close the FD when turning off — the WORM contract
  // is append-only and the file persists; we just stop appending.
}

export function isWormEnabled(): boolean {
  return enabled;
}

export function appendToWorm(row: ToolCallAuditRow): void {
  if (!enabled) return;
  try {
    openHandleIfNeeded();
    if (!state) return;
    const line = JSON.stringify(row) + '\n';
    const writeFn = testOverrides.write ?? defaultWrite;
    writeFn(state.fd, Buffer.from(line, 'utf8'));
  } catch (err) {
    logger.warn({ err }, 'WORM mirror write failed');
  }
}

function openHandleIfNeeded(): void {
  if (state) return;
  if (!resolveUserData) return;
  const dir = resolveUserData();
  const path = join(dir, WORM_FILENAME);
  const openFn = testOverrides.open ?? defaultOpen;
  const fd = openFn(path, 'a');
  state = { fd, path };
  if (process.platform === 'win32') {
    logger.warn(
      { path },
      'WORM enabled on Windows — file permissions cannot be hardened; rely on filesystem ACLs',
    );
    return;
  }
  // The append-only contract is: each new line written stays. We harden the
  // file mode to 0o400 (owner read-only) — the FD we opened with O_APPEND
  // remains writable because the mode check happens at open time, not write.
  // We tolerate any failure here (e.g. ENOENT in tests with a stub `open`).
  if (!existsSync(path)) return;
  try {
    chmodSync(path, 0o400);
  } catch (err) {
    logger.warn({ err, path }, 'WORM chmod failed');
  }
}

function defaultOpen(path: PathLike, flags: string | number): number {
  return openSync(path, flags);
}

function defaultWrite(fd: number, buffer: Buffer): number {
  return writeSync(fd, buffer);
}

/** Test-only: reset module-level state. */
export function _resetWormStateForTesting(): void {
  state = null;
  enabled = false;
  resolveUserData = null;
  testOverrides = {};
}
