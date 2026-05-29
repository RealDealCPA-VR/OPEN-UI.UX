import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
}

export async function atomicWrite(
  absPath: string,
  content: string | Buffer,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  const encoding = opts.encoding ?? 'utf8';
  const tmp = `${absPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

  let fileHandle: FileHandle | null = null;
  try {
    fileHandle = await fs.open(tmp, 'w');
    if (typeof content === 'string') {
      await fileHandle.writeFile(content, { encoding });
    } else {
      await fileHandle.writeFile(content);
    }
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    await fs.rename(tmp, absPath);
    await fsyncDirectory(dir);
  } catch (err) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  let dirHandle: FileHandle | null = null;
  try {
    dirHandle = await fs.open(dir, 'r');
    await dirHandle.sync();
  } catch {
    // best-effort — some filesystems do not support directory fsync
  } finally {
    if (dirHandle) {
      await dirHandle.close().catch(() => {});
    }
  }
}
