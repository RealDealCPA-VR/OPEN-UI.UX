import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { app } from 'electron';
import { logger } from '../logger';
import {
  UnsignedPluginRefusedError,
  installPluginFromPath,
  type InstallPluginOptions,
} from './manager';
import { extractTarGz } from './extract-tarball';
import type { PluginListItem } from '../../shared/plugins';

export interface RegistryInstallRequest {
  installUrl: string;
  acceptUnsigned?: boolean;
}

export type RegistryInstallResult =
  | { ok: true; plugins: PluginListItem[] }
  | { ok: false; reason: 'unsigned'; pluginName: string }
  | { ok: false; reason: 'error'; error: string };

export type FetchImpl = (url: string) => Promise<Response>;

function stagingDir(): string {
  // Fall back to OS tmp when Electron app isn't initialised (e.g. tests
  // that import this module without booting the app shell).
  try {
    return join(app.getPath('userData'), 'plugin-staging');
  } catch {
    return join(tmpdir(), 'opencodex-plugin-staging');
  }
}

function isTarballUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Strip query/fragment before checking suffix.
  const base = lower.split(/[?#]/)[0] ?? lower;
  return base.endsWith('.tgz') || base.endsWith('.tar.gz');
}

async function fileUrlToPath(url: string): Promise<string> {
  const path = fileURLToPath(url);
  if (!existsSync(path)) {
    throw new Error(`local plugin path does not exist: ${path}`);
  }
  return path;
}

async function downloadAndExtractTarball(url: string, fetchImpl: FetchImpl): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`failed to download plugin tarball: HTTP ${response.status}`);
  }
  const body = response.body;
  if (!body) throw new Error('plugin tarball response had no body');
  const root = stagingDir();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'plugin-'));
  // Node 18+ exposes fetch with a Web ReadableStream body. Bridge to Node.
  const nodeStream =
    body instanceof Readable
      ? body
      : Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  try {
    await extractTarGz(nodeStream, dir, { stripFirstSegment: true });
    return dir;
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function installFromRegistryUrl(
  req: RegistryInstallRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<RegistryInstallResult> {
  const opts: InstallPluginOptions = req.acceptUnsigned ? { acceptUnsigned: true } : {};
  let installPath: string;
  try {
    if (req.installUrl.startsWith('file://')) {
      installPath = await fileUrlToPath(req.installUrl);
    } else if (req.installUrl.startsWith('http://') || req.installUrl.startsWith('https://')) {
      if (!isTarballUrl(req.installUrl)) {
        return {
          ok: false,
          reason: 'error',
          error: `unsupported install URL: only .tgz/.tar.gz tarballs and file:// paths are supported (got ${req.installUrl})`,
        };
      }
      installPath = await downloadAndExtractTarball(req.installUrl, fetchImpl);
    } else {
      return {
        ok: false,
        reason: 'error',
        error: `unsupported install URL scheme: ${req.installUrl}`,
      };
    }
  } catch (err) {
    logger.warn({ err, url: req.installUrl }, 'plugin registry install: download/extract failed');
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const plugins = await installPluginFromPath(installPath, opts);
    return { ok: true, plugins };
  } catch (err) {
    if (err instanceof UnsignedPluginRefusedError) {
      return { ok: false, reason: 'unsigned', pluginName: err.pluginName };
    }
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const __testOnly = { isTarballUrl, stagingDir };
