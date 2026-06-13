import { createHash } from 'node:crypto';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { getDb } from '../storage/db';

// Async zlib runs on the libuv threadpool — pre-run snapshots gzip every file
// in the workspace, and the sync variants would block the main-process event
// loop (frozen UI, stalled IPC) for the whole capture/restore.
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

let blobsDirOverride: string | null = null;

export function setBlobsDirForTesting(dir: string | null): void {
  blobsDirOverride = dir;
}

export function blobsDir(): string {
  if (blobsDirOverride) return blobsDirOverride;
  return path.join(app.getPath('userData'), 'checkpoints', 'blobs');
}

function shardPathFor(sha: string): { dir: string; file: string } {
  const shard = sha.slice(0, 2);
  const dir = path.join(blobsDir(), shard);
  return { dir, file: path.join(dir, sha) };
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Content-address a pre-image: gzip on disk, sharded under blobs/<sha[0:2]>/<sha>.
 * Idempotent — re-putting identical bytes is a no-op write. Returns the sha.
 */
export async function putBlob(bytes: Buffer): Promise<string> {
  const sha = sha256(bytes);
  const { dir, file } = shardPathFor(sha);
  try {
    await fs.access(file);
    return sha;
  } catch {
    // not present yet
  }
  await fs.mkdir(dir, { recursive: true });
  const gz = await gzip(bytes);
  // Write to a temp sibling then rename so a crash never leaves a half blob
  // under the content-addressed name (which would otherwise be trusted).
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, gz);
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // If another writer won the race, the final file exists — that's fine.
    try {
      await fs.access(file);
    } catch {
      throw err;
    }
  }
  return sha;
}

export async function getBlob(sha: string): Promise<Buffer | null> {
  const { file } = shardPathFor(sha);
  try {
    const gz = await fs.readFile(file);
    return await gunzip(gz);
  } catch {
    return null;
  }
}

export async function hasBlob(sha: string): Promise<boolean> {
  const { file } = shardPathFor(sha);
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refcount GC: any on-disk blob whose sha is not referenced by a live
 * checkpoint_entries.pre_blob_sha is orphaned and deleted. Returns the number
 * of blobs removed.
 */
export async function gcOrphanBlobs(db: Database.Database = getDb()): Promise<number> {
  const referenced = new Set<string>();
  const rows = db
    .prepare(
      'SELECT DISTINCT pre_blob_sha AS sha FROM checkpoint_entries WHERE pre_blob_sha IS NOT NULL',
    )
    .all() as Array<{ sha: string | null }>;
  for (const row of rows) {
    if (row.sha) referenced.add(row.sha);
  }

  let removed = 0;
  const root = blobsDir();
  let shards: string[];
  try {
    shards = await fs.readdir(root);
  } catch {
    return 0;
  }
  for (const shard of shards) {
    const shardDir = path.join(root, shard);
    let files: string[];
    try {
      files = await fs.readdir(shardDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (name.includes('.tmp-')) {
        await fs.rm(path.join(shardDir, name), { force: true }).catch(() => undefined);
        continue;
      }
      if (referenced.has(name)) continue;
      try {
        await fs.rm(path.join(shardDir, name), { force: true });
        removed++;
      } catch (err) {
        logger.warn({ err, blob: name }, 'checkpoint blob gc: failed to remove orphan');
      }
    }
  }
  return removed;
}
