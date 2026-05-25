import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ChatAttachment, PrepareAttachmentsResponse } from '../../shared/attachments';
import { ATTACHMENT_IMAGE_BYTE_LIMIT, ATTACHMENT_TEXT_BYTE_LIMIT } from '../../shared/attachments';

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const TEXT_EXTS: ReadonlySet<string> = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.rst',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.lua',
  '.sql',
  '.r',
  '.scala',
  '.dart',
  '.gradle',
  '.dockerfile',
  '.gitignore',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.log',
  '.diff',
  '.patch',
]);

function classify(path: string): 'image' | 'text' | 'binary' {
  const ext = extname(path).toLowerCase();
  if (ext in IMAGE_EXT_TO_MIME) return 'image';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'binary';
}

function looksLikeUtf8Text(bytes: Buffer): boolean {
  const slice = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of slice) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32 && byte !== 27)) suspicious += 1;
  }
  return suspicious / slice.length < 0.05;
}

export async function prepareAttachments(paths: string[]): Promise<PrepareAttachmentsResponse> {
  const prepared: ChatAttachment[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        errors.push({ path, message: 'Directories are not supported as attachments.' });
        continue;
      }
      const sizeBytes = info.size;
      const name = basename(path);
      const ext = extname(path).toLowerCase();
      const kind = classify(path);

      if (kind === 'image') {
        if (sizeBytes > ATTACHMENT_IMAGE_BYTE_LIMIT) {
          errors.push({
            path,
            message: `Image is ${formatBytes(sizeBytes)}, exceeds ${formatBytes(ATTACHMENT_IMAGE_BYTE_LIMIT)} limit.`,
          });
          continue;
        }
        const bytes = await readFile(path);
        prepared.push({
          kind: 'image',
          name,
          path,
          mimeType: IMAGE_EXT_TO_MIME[ext] ?? 'application/octet-stream',
          data: bytes.toString('base64'),
          sizeBytes,
        });
        continue;
      }

      if (kind === 'text') {
        const bytes = await readFile(path);
        if (!looksLikeUtf8Text(bytes)) {
          prepared.push({
            kind: 'binary',
            name,
            path,
            mimeType: 'application/octet-stream',
            sizeBytes,
          });
          continue;
        }
        const truncated = bytes.length > ATTACHMENT_TEXT_BYTE_LIMIT;
        const slice = truncated ? bytes.subarray(0, ATTACHMENT_TEXT_BYTE_LIMIT) : bytes;
        prepared.push({
          kind: 'text',
          name,
          path,
          mimeType: 'text/plain',
          text: slice.toString('utf8'),
          truncated,
          sizeBytes,
        });
        continue;
      }

      prepared.push({
        kind: 'binary',
        name,
        path,
        mimeType: 'application/octet-stream',
        sizeBytes,
      });
    } catch (err) {
      errors.push({ path, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { prepared, errors };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
