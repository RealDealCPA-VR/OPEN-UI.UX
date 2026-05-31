import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function atomicWrite(
  absPath: string,
  content: string | Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    // Text is written UTF-8; binary payloads (generated PDF/DOCX/XLSX) are
    // written as-is. fs.writeFile ignores the encoding option for non-strings.
    if (typeof content === 'string') {
      await fs.writeFile(tmp, content, { encoding: 'utf8', signal });
    } else {
      await fs.writeFile(tmp, content, { signal });
    }
    await fs.rename(tmp, absPath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
