import { promises as fs } from 'node:fs';
import { PathEscapesWorkspaceError, resolveWithinWorkspace } from '@opencodex/tools';
import type { FilePreviewResult } from '../../shared/approvals';
import { FILE_PREVIEW_MAX_BYTES } from '../../shared/approvals';

export async function readFilePreview(
  workspaceRoot: string,
  requestedPath: string,
  maxBytes: number = FILE_PREVIEW_MAX_BYTES,
): Promise<FilePreviewResult> {
  let resolved: string;
  try {
    resolved = await resolveWithinWorkspace(workspaceRoot, requestedPath);
  } catch (err) {
    if (err instanceof PathEscapesWorkspaceError) {
      return { exists: false, content: '', truncated: false, sizeBytes: 0 };
    }
    throw err;
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: '', truncated: false, sizeBytes: 0 };
    }
    throw err;
  }
  if (!stat.isFile()) {
    return { exists: false, content: '', truncated: false, sizeBytes: 0 };
  }

  const size = stat.size;
  if (size <= maxBytes) {
    const buf = await fs.readFile(resolved);
    return {
      exists: true,
      content: buf.toString('utf8'),
      truncated: false,
      sizeBytes: size,
    };
  }

  const fh = await fs.open(resolved, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return {
      exists: true,
      content: buf.subarray(0, bytesRead).toString('utf8'),
      truncated: true,
      sizeBytes: size,
    };
  } finally {
    await fh.close();
  }
}
