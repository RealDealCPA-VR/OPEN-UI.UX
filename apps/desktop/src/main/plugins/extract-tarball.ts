import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

/*
 * Minimal POSIX/ustar tar extractor. We avoid a third-party tar dependency
 * (no extraction lib exists in the desktop tree) and accept only the small
 * subset of tar features that npm-pack-style plugin tarballs use: regular
 * files (typeflag '0' / '\0') and directories ('5'). Anything else
 * (symlinks, hardlinks, character devices) is rejected on principle —
 * extracting them from an attacker-controlled tarball is a path-traversal /
 * privilege footgun.
 */

const TAR_BLOCK = 512;
const TAR_MAGIC_USTAR = 'ustar';

interface TarHeader {
  name: string;
  size: number;
  typeflag: string;
  prefix: string;
}

function readString(buf: Buffer, off: number, len: number): string {
  const end = buf.indexOf(0, off);
  const stop = end === -1 || end > off + len ? off + len : end;
  return buf.toString('utf8', off, stop);
}

function readOctal(buf: Buffer, off: number, len: number): number {
  const raw = readString(buf, off, len).trim();
  if (raw.length === 0) return 0;
  return Number.parseInt(raw, 8);
}

function parseHeader(buf: Buffer): TarHeader | null {
  // All-zero blocks mark end-of-archive; the spec calls for two of them.
  let allZero = true;
  for (let i = 0; i < TAR_BLOCK; i++) {
    if (buf[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return null;
  const magic = readString(buf, 257, 6);
  if (!magic.startsWith(TAR_MAGIC_USTAR)) {
    throw new Error(`unsupported tar format: missing ustar magic (got "${magic}")`);
  }
  const name = readString(buf, 0, 100);
  const size = readOctal(buf, 124, 12);
  const typeflag = String.fromCharCode(buf[156] ?? 0);
  const prefix = readString(buf, 345, 155);
  return { name, size, typeflag, prefix };
}

function joinTarPath(prefix: string, name: string): string {
  if (prefix.length === 0) return name;
  if (prefix.endsWith('/')) return prefix + name;
  return prefix + '/' + name;
}

function stripFirstSegment(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.indexOf('/');
  return idx === -1 ? '' : norm.slice(idx + 1);
}

function assertSafePath(destRoot: string, relative: string): string {
  if (relative.length === 0) throw new Error('tar entry has empty path');
  if (isAbsolute(relative) || relative.startsWith('/') || relative.startsWith('\\')) {
    throw new Error(`tar entry uses absolute path: ${relative}`);
  }
  if (relative.includes('\0')) throw new Error(`tar entry contains NUL byte: ${relative}`);
  const rootResolved = resolve(destRoot);
  const resolved = resolve(rootResolved, relative);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (resolved !== rootResolved && !resolved.startsWith(rootWithSep)) {
    throw new Error(`tar entry escapes destination: ${relative}`);
  }
  return resolved;
}

export interface ExtractOptions {
  // Strip the leading directory segment (the way `tar -xz --strip-components=1`
  // does). npm pack produces tarballs with a single top-level `package/`
  // directory, so callers normally want this on.
  stripFirstSegment?: boolean;
  // Max uncompressed bytes accepted before we abort with an error — defense
  // against decompression bombs.
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB

type WriteStream = ReturnType<typeof createWriteStream>;

export async function extractTarGz(
  source: Readable,
  destRoot: string,
  options: ExtractOptions = {},
): Promise<void> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const strip = options.stripFirstSegment === true;
  await mkdir(destRoot, { recursive: true });

  const gunzip = createGunzip();
  source.on('error', (err) => gunzip.destroy(err));
  source.pipe(gunzip);

  let buffered: Buffer = Buffer.alloc(0);
  let total = 0;
  let header: TarHeader | null = null;
  let remainingForFile = 0;
  // 1-element holder so TS doesn't narrow this to `null` after closeActive resets it.
  const writeHolder: { current: WriteStream | null } = { current: null };

  const closeActive = async (): Promise<void> => {
    const cur = writeHolder.current;
    if (cur === null) return;
    writeHolder.current = null;
    await new Promise<void>((resolveClose, rejectClose) => {
      cur.once('error', rejectClose);
      cur.end(() => resolveClose());
    });
  };

  const openFile = async (h: TarHeader): Promise<void> => {
    const raw = joinTarPath(h.prefix, h.name);
    const rel = normalize(strip ? stripFirstSegment(raw) : raw);
    if (rel.length === 0 || rel === '.') {
      // Top-level directory after strip — nothing to create.
      return;
    }
    const dest = assertSafePath(destRoot, rel);
    if (h.typeflag === '5') {
      await mkdir(dest, { recursive: true });
      return;
    }
    if (h.typeflag !== '0' && h.typeflag !== ' ') {
      throw new Error(`unsupported tar entry type "${h.typeflag}" for ${rel}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    writeHolder.current = createWriteStream(dest);
  };

  for await (const chunk of gunzip) {
    total += chunk.length;
    if (total > maxBytes) {
      gunzip.destroy();
      throw new Error(`tarball exceeds max uncompressed size (${maxBytes} bytes)`);
    }
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);

    while (buffered.length > 0) {
      if (!header) {
        if (buffered.length < TAR_BLOCK) break;
        const block = buffered.subarray(0, TAR_BLOCK);
        buffered = buffered.subarray(TAR_BLOCK);
        header = parseHeader(block);
        if (!header) {
          // End-of-archive marker — drain remaining input silently.
          await closeActive();
          return;
        }
        remainingForFile = header.size;
        await openFile(header);
        if (remainingForFile === 0) {
          await closeActive();
          header = null;
        }
        continue;
      }
      if (remainingForFile > 0) {
        const take = Math.min(remainingForFile, buffered.length);
        const slice = buffered.subarray(0, take);
        buffered = buffered.subarray(take);
        const cur = writeHolder.current;
        if (cur !== null) {
          if (!cur.write(slice)) {
            await new Promise<void>((res) => cur.once('drain', () => res()));
          }
        }
        remainingForFile -= take;
        if (remainingForFile === 0) {
          await closeActive();
        }
        continue;
      }
      // File body fully consumed — eat the trailing padding to the next block boundary.
      const written = header.size;
      const padded = Math.ceil(written / TAR_BLOCK) * TAR_BLOCK;
      const pad = padded - written;
      if (buffered.length < pad) break;
      buffered = buffered.subarray(pad);
      header = null;
    }
  }
  await closeActive();
}

export const __testOnly = {
  parseHeader,
  joinTarPath,
  stripFirstSegment,
  assertSafePath,
};
