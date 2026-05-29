import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function atomicWrite(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, content, { encoding: 'utf8' });
    await fs.rename(tmp, absPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
